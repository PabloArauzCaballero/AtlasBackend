/**
 * @file Servicio de aplicación: la única puerta por la que un caso cambia de estado.
 * @business Garantiza que todo cambio quede validado, fechado, con autor y con su reloj ajustado.
 * @system bloquea la fila, valida la transición, escribe el evento encadenado y mueve el SLA.
 */
import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import type { SupportCaseModel } from '../../../database/models/index.js';
import { assertTransition } from '../domain/case-state-machine.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import type { SupportCaseEventType, SupportCaseStatus } from '../support.constants.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportSlaService } from './support-sla.service.js';

export interface TransitionInput {
  tenantId: string;
  caseId: string;
  actor: SupportActor;
  to: SupportCaseStatus;
  eventType: SupportCaseEventType;
  payload: Record<string, unknown>;
  transaction: Transaction;
  /** Campos del caso que cambian junto con el estado (asignado, resuelto, contadores). */
  extra?: Record<string, unknown>;
  correlationId?: string | null;
}

@Injectable()
export class SupportCaseTransitionService {
  constructor(
    private readonly cases: SupportCaseRepository,
    private readonly catalog: SupportCatalogRepository,
    private readonly sla: SupportSlaService,
  ) {}

  /**
   * Cambia el estado del caso, o falla sin escribir nada.
   *
   * ## El orden no es casual
   *
   * 1. **Bloquear la fila.** Dos agentes resolviendo el mismo caso leerían ambos `IN_PROGRESS`,
   *    ambos validarían y ambos escribirían. Con el `FOR UPDATE`, el segundo lee ya `RESOLVED` y su
   *    transición se rechaza con 409 — que es lo que su pantalla necesita para recargar.
   * 2. **Validar la transición.** Antes de tocar nada: un caso no salta de `NEW` a `CLOSED`.
   * 3. **Actualizar el estado y sus campos.**
   * 4. **Escribir el evento**, encadenado al anterior.
   * 5. **Mover el reloj**, con la política que le tocó al caso.
   *
   * Todo dentro de la transacción que recibe: quien llama decide el alcance, porque casi siempre hay
   * algo más que guardar —una asignación, una resolución— y partirlo en dos transacciones dejaría
   * casos resueltos sin resolución escrita.
   */
  async apply(input: TransitionInput): Promise<SupportCaseModel> {
    const supportCase = await this.cases.lockById(input.tenantId, input.caseId, input.transaction);
    const from = supportCase.status as SupportCaseStatus;
    assertTransition(from, input.to);

    await this.cases.update(
      input.tenantId,
      input.caseId,
      { status: input.to, ...(input.extra ?? {}) } as Partial<SupportCaseModel>,
      { transaction: input.transaction },
    );

    await this.cases.appendEvent(
      {
        tenantId: input.tenantId,
        caseId: input.caseId,
        eventType: input.eventType,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        payload: { ...input.payload, from, to: input.to },
        correlationId: input.correlationId ?? null,
      },
      input.transaction,
    );

    // El evento de cambio de estado sólo se añade si el que pidió quien llama era OTRO: si ya pidió
    // `CASE_STATUS_CHANGED`, escribirlo de nuevo duplica la misma línea en la historia del caso.
    if (from !== input.to && input.eventType !== 'CASE_STATUS_CHANGED') {
      await this.cases.appendEvent(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          eventType: 'CASE_STATUS_CHANGED',
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          payload: { from, to: input.to },
        },
        input.transaction,
      );
    }

    const policy = supportCase.slaPolicyVersionId
      ? await this.catalog.findSlaPolicyById(input.tenantId, String(supportCase.slaPolicyVersionId), { transaction: input.transaction })
      : null;

    const clockChange = await this.sla.applyStatusChange({
      caseId: input.caseId,
      status: input.to,
      policy,
      at: new Date(),
      transaction: input.transaction,
    });

    if (clockChange !== 'unchanged') {
      await this.cases.appendEvent(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          eventType: clockChange === 'paused' ? 'SLA_CLOCK_PAUSED' : 'SLA_CLOCK_RESUMED',
          actorType: 'SYSTEM',
          actorId: null,
          payload: { status: input.to, policyVersionId: supportCase.slaPolicyVersionId },
        },
        input.transaction,
      );
    }

    return supportCase;
  }

  /**
   * Refleja que un agente habló: avanza el caso a «en curso» y marca la primera respuesta humana.
   *
   * Se registra cuando un AGENTE escribe algo público —no cuando el sistema acusa recibo—, porque
   * el indicador existe para medir cuánto tarda una persona en contestarle a otra. Contar el aviso
   * automático dejaría un tablero impecable y clientes esperando igual.
   */
  async recordFirstResponse(input: {
    tenantId: string;
    caseId: string;
    at: Date;
    actor: SupportActor;
    transaction: Transaction;
  }): Promise<void> {
    const supportCase = await this.cases.findById(input.tenantId, input.caseId, { transaction: input.transaction });
    if (!supportCase) return;

    // Responderle a alguien ES trabajar su caso. Sin esto, un agente que contesta y resuelve en la
    // misma conversación choca con un 409 por no haber pulsado antes un botón que no aporta nada.
    if (['TRIAGED', 'ASSIGNED', 'REOPENED'].includes(supportCase.status)) {
      await this.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: 'IN_PROGRESS',
        eventType: 'CASE_STATUS_CHANGED',
        payload: { trigger: 'agent_public_message' },
        transaction: input.transaction,
      });
    }

    if (supportCase.firstResponseAt) return;

    await this.cases.update(input.tenantId, input.caseId, { firstResponseAt: input.at }, { transaction: input.transaction });
    await this.sla.satisfyClock({ caseId: input.caseId, metricType: 'ACKNOWLEDGE', at: input.at, transaction: input.transaction });
    await this.sla.satisfyClock({ caseId: input.caseId, metricType: 'FIRST_RESPONSE', at: input.at, transaction: input.transaction });
    await this.cases.appendEvent(
      {
        tenantId: input.tenantId,
        caseId: input.caseId,
        eventType: 'FIRST_RESPONSE_RECORDED',
        actorType: 'SYSTEM',
        actorId: null,
        payload: { at: input.at.toISOString() },
      },
      input.transaction,
    );
  }
}
