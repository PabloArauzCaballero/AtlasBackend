/**
 * @file Servicio de aplicación: los relojes que miden lo que se prometió.
 * @business Hace visible el incumplimiento en vez de dejar que se esconda tras un estado de espera.
 * @system crea, pausa, satisface y marca incumplidos los relojes de `support_sla_clocks`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Transaction } from 'sequelize';
import type { SupportSlaPolicyModel } from '../../../database/models/index.js';
import { EventsService } from '../../events/events.service.js';
import { addBusinessMinutes, calendarFromPolicy } from '../domain/business-hours.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import type { SupportCaseStatus } from '../support.constants.js';

/** Los relojes que se abren con el caso. `CLOSE` se abre al resolver, no antes. */
const INITIAL_METRICS = ['ACKNOWLEDGE', 'FIRST_RESPONSE', 'RESOLUTION'] as const;

@Injectable()
export class SupportSlaService {
  private readonly logger = new Logger(SupportSlaService.name);

  constructor(
    private readonly timeline: SupportCaseTimelineRepository,
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
   * Barrido del vigilante: marca lo vencido y publica el evento.
   *
   * Existe como barrido y no como comprobación al leer el caso porque un incumplimiento que sólo se
   * detecta cuando alguien abre la pantalla es un incumplimiento que nadie ve el fin de semana. El
   * evento va por outbox: si el motor de notificaciones está caído, el incumplimiento igual queda
   * marcado y el aviso sale después.
   */
  async sweepBreaches(tenantId: string, now: Date = new Date()): Promise<{ breached: number }> {
    const clocks = await this.timeline.findBreachedClocks(tenantId, now);
    let breached = 0;

    for (const clock of clocks) {
      await this.timeline.updateClock(String(clock.id), { state: 'BREACHED', breachedAt: now });
      breached += 1;
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
}
