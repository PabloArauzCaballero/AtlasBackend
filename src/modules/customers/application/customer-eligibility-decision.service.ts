/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CustomerLifecycleStatus } from '../customer-lifecycle.constants.js';
import { CustomersRepository } from '../customers.repository.js';
import { CustomerEligibilityService } from './customer-eligibility.service.js';
import { CustomerLifecycleService } from './customer-lifecycle.service.js';

export type EligibilityDecision = 'approve' | 'reject' | 'observe' | 'suspend' | 'reinstate';

/** Traducción de la decisión del analista al estado destino. Tabla explícita, no `if` anidados. */
const DECISION_TO_STATUS: Readonly<Record<EligibilityDecision, CustomerLifecycleStatus>> = {
  approve: 'active',
  reject: 'rejected',
  observe: 'observed',
  suspend: 'suspended',
  reinstate: 'under_review',
};

/**
 * Decisión administrativa sobre la habilitación de un cliente (N10).
 *
 * Es el camino auditado para que una persona apruebe, rechace, observe, suspenda o reincorpore a un
 * cliente. Toda decisión:
 *
 *  - pasa por la máquina de estados (una transición ilegal se rechaza, no se fuerza),
 *  - escribe estado e historial en la MISMA transacción, con el estado anterior real,
 *  - deja una evaluación de elegibilidad marcada como `manual_decision`, de modo que la evidencia
 *    distinga siempre lo que decidió la regla de lo que decidió una persona.
 *
 * Aprobar por esta vía cuando la regla automática todavía ve bloqueadores es una EXCEPCIÓN, y como
 * tal queda registrada con `decision_source = 'manual_override'` y los bloqueadores que se saltaron.
 */
@Injectable()
export class CustomerEligibilityDecisionService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly eligibilityService: CustomerEligibilityService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async decide(input: {
    tenantId: string;
    customerId: string;
    decision: EligibilityDecision;
    reasonCode: string;
    notes: string | null;
    currentUser: AuthenticatedUser;
  }) {
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const toStatus = DECISION_TO_STATUS[input.decision];

    return this.sequelize.transaction(async (transaction) => {
      const assessmentBefore = await this.eligibilityService.evaluate(input.tenantId, input.customerId, transaction);
      const isOverride = input.decision === 'approve' && !assessmentBefore.eligible;

      const transitioned = await this.lifecycleService.transition({
        tenantId: input.tenantId,
        customerId: input.customerId,
        toStatus,
        reasonCode: input.reasonCode,
        changedByType: input.currentUser.role,
        changedByInternalUserId: input.currentUser.internalUserId ?? null,
        notes: input.notes,
        transaction,
      });

      const recorded = await this.eligibilityService.evaluateAndRecord({
        tenantId: input.tenantId,
        customerId: input.customerId,
        evaluatedByType: input.currentUser.role,
        evaluatedByInternalUserId: input.currentUser.internalUserId ?? null,
        decisionSource: isOverride ? 'manual_override' : 'manual_decision',
        reasonCode: input.reasonCode,
        notes: buildNotes(
          input.notes,
          isOverride,
          assessmentBefore.blockers.map((blocker) => blocker.code),
        ),
        transaction,
      });

      return {
        customerId: input.customerId,
        decision: input.decision,
        previousStatus: transitioned.previousStatus,
        lifecycleStatus: transitioned.newStatus,
        statusChanged: transitioned.changed,
        eligible: recorded.eligible,
        overriddenBlockers: isOverride ? assessmentBefore.blockers.map((blocker) => blocker.code) : [],
        blockers: recorded.blockers,
      };
    });
  }
}

function buildNotes(notes: string | null, isOverride: boolean, blockers: string[]): string | null {
  if (!isOverride) return notes;
  const overrideNote = `EXCEPCIÓN AUTORIZADA — bloqueadores omitidos: ${blockers.join(', ')}.`;
  return notes ? `${overrideNote} ${notes}` : overrideNote;
}
