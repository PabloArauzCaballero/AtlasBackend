/**
 * @file Servicio de aplicación: los relojes que miden lo que se prometió.
 * @business Hace visible el incumplimiento en vez de dejar que se esconda tras un estado de espera.
 * @system crea, pausa, satisface y marca incumplidos los relojes de `support_sla_clocks`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { SupportSlaPolicyModel } from '../../../database/models/index.js';
import { EventsService } from '../../events/events.service.js';
import { addBusinessMinutes, calendarFromPolicy } from '../domain/business-hours.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import type { SupportCaseStatus } from '../support.constants.js';

/** Los relojes que se abren con el caso. `CLOSE` se abre al resolver, no antes. */
const INITIAL_METRICS = ['ACKNOWLEDGE', 'FIRST_RESPONSE', 'RESOLUTION'] as const;

@Injectable()
export class SupportSlaService {
  private readonly logger = new Logger(SupportSlaService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly cases: SupportCaseRepository,
    private readonly catalog: SupportCatalogRepository,
    private readonly events: EventsService,
  ) {}

  /**
   * Arranca los relojes del caso con la política que le tocó.
   *
   * Se guarda `policy_version_id` en cada reloj —no sólo en el caso— porque el reloj es lo que se
   * consulta al medir: si mañana el caso cambiara de política por una reclasificación, los relojes
   * ya corridos deben seguir explicando con qué plazo se midieron.
   */
  async startClocks(input: {
    tenantId: string;
    caseId: string;
    policy: SupportSlaPolicyModel | null;
    openedAt: Date;
    transaction: Transaction;
  }): Promise<void> {
    if (!input.policy) return;
    const calendar = calendarFromPolicy({
      calendarKind: input.policy.calendarKind,
      timezone: input.policy.timezone,
      businessHoursJson: input.policy.businessHoursJson,
    });

    for (const metric of INITIAL_METRICS) {
      const minutes = this.targetMinutes(input.policy, metric);
      await this.timeline.createClock(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          metricType: metric,
          policyVersionId: String(input.policy.id),
          startedAt: input.openedAt,
          targetAt: addBusinessMinutes(input.openedAt, minutes, calendar),
          totalPausedSeconds: 0,
          state: 'RUNNING',
          warnedPercentsJson: [],
        },
        { transaction: input.transaction },
      );
    }
  }

  private targetMinutes(policy: SupportSlaPolicyModel, metric: (typeof INITIAL_METRICS)[number]): number {
    if (metric === 'ACKNOWLEDGE') return policy.acknowledgeTargetMinutes;
    if (metric === 'FIRST_RESPONSE') return policy.firstResponseTargetMinutes;
    return policy.resolutionTargetMinutes;
  }

  /**
   * Cierra un reloj como cumplido o incumplido según la hora real, no según el deseo.
   *
   * Si la primera respuesta llegó después del objetivo, el reloj queda `BREACHED` aunque el caso
   * termine bien: mezclar «se resolvió» con «se respondió a tiempo» es lo que hace que un tablero
   * verde conviva con clientes esperando cuatro horas.
   */
  async satisfyClock(input: { caseId: string; metricType: string; at: Date; transaction?: Transaction }): Promise<void> {
    const clock = await this.timeline.findClock(input.caseId, input.metricType, { transaction: input.transaction });
    if (!clock || clock.satisfiedAt) return;

    const breached = input.at.getTime() > new Date(clock.targetAt).getTime();
    await this.timeline.updateClock(
      String(clock.id),
      {
        satisfiedAt: input.at,
        state: breached ? 'BREACHED' : 'MET',
        breachedAt: breached ? (clock.breachedAt ?? input.at) : clock.breachedAt,
      },
      { transaction: input.transaction },
    );
  }

  /**
   * Aplica al reloj de resolución el cambio de estado del caso.
   *
   * La pausa NO es automática por estar esperando: depende de que la política lo permita. Un
   * acuerdo que cuenta tiempo total no debe congelarse porque alguien puso el caso «en espera del
   * cliente»; si se congelara, bastaría ese estado para que ningún caso incumpliera jamás.
   */
  async applyStatusChange(input: {
    caseId: string;
    status: SupportCaseStatus;
    policy: SupportSlaPolicyModel | null;
    at: Date;
    transaction: Transaction;
  }): Promise<'paused' | 'resumed' | 'unchanged'> {
    if (!input.policy) return 'unchanged';
    const clock = await this.timeline.findClock(input.caseId, 'RESOLUTION', { transaction: input.transaction });
    if (!clock || clock.satisfiedAt) return 'unchanged';

    const shouldPause =
      (input.status === 'WAITING_CUSTOMER' && input.policy.pauseOnWaitingCustomer) ||
      (input.status === 'WAITING_PARTNER' && input.policy.pauseOnWaitingPartner) ||
      (input.status === 'WAITING_INTERNAL' && input.policy.pauseOnWaitingInternal) ||
      input.status === 'ON_HOLD';

    if (shouldPause && !clock.pausedAt) {
      await this.timeline.updateClock(String(clock.id), { pausedAt: input.at, state: 'PAUSED' }, { transaction: input.transaction });
      return 'paused';
    }

    if (!shouldPause && clock.pausedAt) {
      const pausedSeconds = Math.max(0, Math.round((input.at.getTime() - new Date(clock.pausedAt).getTime()) / 1000));
      const calendar = calendarFromPolicy({
        calendarKind: input.policy.calendarKind,
        timezone: input.policy.timezone,
        businessHoursJson: input.policy.businessHoursJson,
      });
      // El objetivo se corre lo que duró la pausa: pausar sin mover el vencimiento sería no pausar.
      const target = calendar
        ? addBusinessMinutes(new Date(clock.targetAt), Math.round(pausedSeconds / 60), calendar)
        : new Date(new Date(clock.targetAt).getTime() + pausedSeconds * 1000);

      await this.timeline.updateClock(
        String(clock.id),
        {
          pausedAt: null,
          state: 'RUNNING',
          totalPausedSeconds: clock.totalPausedSeconds + pausedSeconds,
          targetAt: target,
        },
        { transaction: input.transaction },
      );
      return 'resumed';
    }

    return 'unchanged';
  }

  /** Cancela lo que quede corriendo cuando el caso deja de estar vivo. */
  async cancelRunningClocks(caseId: string, transaction: Transaction): Promise<void> {
    const clocks = await this.timeline.listClocks(caseId, { transaction });
    for (const clock of clocks) {
      if (clock.satisfiedAt || clock.state === 'BREACHED' || clock.state === 'CANCELLED') continue;
      await this.timeline.updateClock(String(clock.id), { state: 'CANCELLED' }, { transaction });
    }
  }

  /**
   * Barrido del vigilante: marca lo vencido, lo escribe en el expediente y publica el evento.
   *
   * Existe como barrido y no como comprobación al leer el caso porque un incumplimiento que sólo se
   * detecta cuando alguien abre la pantalla es un incumplimiento que nadie ve el fin de semana. El
   * evento de integración va por outbox: si el motor de notificaciones está caído, el incumplimiento
   * igual queda marcado y el aviso sale después.
   *
   * ## Por qué también se escribe en `support_case_events`
   *
   * Porque el expediente es lo que se audita, y hasta ahora el incumplimiento sólo existía como una
   * columna del reloj y un mensaje en una cola. Quien reconstruyera la historia de un caso —una
   * revisión interna, un reclamo, el propio cliente— no encontraba rastro de que se hubiera
   * prometido algo y no se hubiera cumplido. El tipo `SLA_BREACHED` estaba declarado desde el
   * principio y nadie lo emitía.
   */
  async sweepBreaches(tenantId: string, now: Date = new Date()): Promise<{ breached: number }> {
    const clocks = await this.timeline.findBreachedClocks(tenantId, now);
    let breached = 0;

    for (const clock of clocks) {
      await this.timeline.updateClock(String(clock.id), { state: 'BREACHED', breachedAt: now });
      breached += 1;

      await this.recordClockEvent(tenantId, clock.caseId, 'SLA_BREACHED', {
        metricType: clock.metricType,
        targetAt: new Date(clock.targetAt).toISOString(),
        breachedAt: now.toISOString(),
        minutesLate: Math.round((now.getTime() - new Date(clock.targetAt).getTime()) / 60_000),
      });

      try {
        await this.events.publish({
          tenantId,
          eventCode: 'support.sla.breached',
          aggregateType: 'support_case',
          aggregateId: String(clock.caseId),
          payload: { caseId: String(clock.caseId), metricType: clock.metricType, targetAt: clock.targetAt },
          idempotencyKey: `support-sla-breach-${clock.id}`,
          sourceModule: 'support',
          sourceAction: 'sweep_sla_breaches',
        });
      } catch (error) {
        // El evento es un aviso; la marca de incumplimiento ya está escrita y no debe perderse por él.
        this.logger.warn(`No se pudo publicar support.sla.breached para el reloj ${clock.id}: ${String(error)}`);
      }
    }

    return { breached };
  }

  /**
   * Barrido del aviso previo: el que da tiempo a evitar el incumplimiento.
   *
   * `warning_percents_json` de la política existía desde la primera migración y `warnedPercentsJson`
   * del reloj se inicializaba vacío en cada creación, pero **nadie los leía nunca**: el único aviso
   * posible era el que llega cuando ya es tarde. Un compromiso que sólo se comunica una vez roto no
   * es un compromiso gestionado, es un informe de daños.
   *
   * El porcentaje se mide sobre el tiempo transcurrido frente al total prometido, y cada umbral se
   * anota en el reloj al emitirse: por eso una pasada cada minuto no repite el aviso del 75 % sesenta
   * veces por hora. El avance se calcula en tiempo real, no hábil, a propósito — el aviso interno
   * debe llegar aunque el vencimiento caiga fuera de horario, que es justo cuando nadie mira.
   */
  async sweepWarnings(tenantId: string, now: Date = new Date()): Promise<{ warned: number }> {
    const clocks = await this.timeline.findRunningClocks(tenantId, now);
    let warned = 0;

    for (const clock of clocks) {
      const policy = clock.policyVersionId ? await this.catalog.findSlaPolicyById(tenantId, clock.policyVersionId) : null;
      const thresholds = policy?.warningPercentsJson ?? [];
      if (thresholds.length === 0) continue;

      const startedAt = new Date(clock.startedAt).getTime();
      const targetAt = new Date(clock.targetAt).getTime();
      const total = targetAt - startedAt;
      if (total <= 0) continue;

      const elapsedPercent = ((now.getTime() - startedAt) / total) * 100;
      const already = clock.warnedPercentsJson ?? [];
      const due = thresholds.filter((percent) => elapsedPercent >= percent && !already.includes(percent));
      if (due.length === 0) continue;

      await this.timeline.updateClock(String(clock.id), { warnedPercentsJson: [...already, ...due].sort((a, b) => a - b) });
      warned += 1;

      // Un solo evento por pasada aunque se crucen dos umbrales: la historia registra hasta dónde
      // llegó el reloj, no cuántas veces se comprobó.
      await this.recordClockEvent(tenantId, clock.caseId, 'SLA_WARNING', {
        metricType: clock.metricType,
        targetAt: new Date(clock.targetAt).toISOString(),
        reachedPercents: due,
        minutesRemaining: Math.round((targetAt - now.getTime()) / 60_000),
      });
    }

    return { warned };
  }

  /**
   * Escribe el evento del reloj en la historia del caso, con su propia transacción.
   *
   * El actor es `SYSTEM` porque nadie decidió esto: lo decidió el tiempo. Un fallo al escribir no
   * puede tumbar el barrido —el resto de relojes tiene que seguir revisándose—, así que se registra
   * y se continúa; la marca en el reloj ya está puesta y es la que sostiene la medición.
   */
  private async recordClockEvent(
    tenantId: string,
    caseId: string,
    eventType: 'SLA_BREACHED' | 'SLA_WARNING',
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.sequelize.transaction(async (transaction) => {
        await this.cases.appendEvent(
          { tenantId, caseId: String(caseId), eventType, actorType: 'SYSTEM', actorId: 'system', payload },
          transaction,
        );
      });
    } catch (error) {
      this.logger.warn(`No se pudo escribir ${eventType} en el caso ${caseId}: ${String(error)}`);
    }
  }
}
