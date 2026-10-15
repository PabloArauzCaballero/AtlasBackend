/**
 * @file Servicio de aplicación: reclasificar un caso de soporte.
 * @business Corrige la cola, la prioridad y la sensibilidad de un caso sin ablandar su restricción.
 * @system resuelve la clasificación con el enrutador, aplica la transición y deja auditoría.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportCaseRepository } from '../support-case.repository.js';
import type { TriageCaseDto } from '../support-case.schemas.js';
import type { SupportCaseType } from '../support.constants.js';
import { toInternalCaseDto } from '../support.mapper.js';
import { sensitivityFor, strictestSensitivity } from './support-case-factory.service.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseRoutingService } from './support-case-routing.service.js';
import { SupportCaseTransitionService } from './support-case-transition.service.js';

@Injectable()
export class SupportCaseTriageService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cases: SupportCaseRepository,
    private readonly transitions: SupportCaseTransitionService,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
    private readonly enrutado: SupportCaseRoutingService,
  ) {}

  /** Reclasificar. Cambia cola, prioridad y con ellas el trabajo que el caso genera. */
  async triage(input: { tenantId: string; actor: SupportActor; caseId: string; dto: TriageCaseDto }) {
    this.actors.assertIsAgent(input.actor);

    const updated = await this.sequelize.transaction(async (transaction) => {
      const supportCase = await this.cases.requireById(input.tenantId, input.caseId, { transaction });
      // Lo que no se puede abrir tampoco se puede reclasificar: sin esto, RESTRICTED sólo valía al leer.
      await this.actors.assertCanViewCase(input.actor, supportCase, input.tenantId);
      const classification = await this.enrutado.resolveClassification(input.tenantId, input.actor, supportCase, input.dto, transaction);
      const { category, queue, impact, urgency, caseType, priority } = classification;

      await this.transitions.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: supportCase.status === 'NEW' ? 'TRIAGED' : (supportCase.status as never),
        eventType: 'CASE_TRIAGED',
        payload: { reason: input.dto.reason, priority, queueCode: input.dto.queueCode ?? null },
        transaction,
        extra: {
          categoryId: category ? String(category.id) : supportCase.categoryId,
          caseType,
          domain: input.dto.domain ?? supportCase.domain,
          impact,
          urgency,
          priority,
          sensitivity: this.triagedSensitivity(input.actor, supportCase.sensitivity, caseType, category?.sensitivity),
          queueId: queue ? String(queue.id) : supportCase.queueId,
          internalSummary: input.dto.internalSummary ?? supportCase.internalSummary,
          triagedAt: supportCase.triagedAt ?? new Date(),
        },
      });

      return this.cases.requireById(input.tenantId, input.caseId, { transaction });
    });

    await this.audit.record({
      tenantId: input.tenantId,
      actor: input.actor,
      actionCode: 'support.case.triage',
      targetType: 'support_case',
      targetId: input.caseId,
      payload: { reason: input.dto.reason },
    });
    return toInternalCaseDto(updated);
  }

  /**
   * La sensibilidad tras reclasificar: la del motivo nuevo con el piso de su tipo, igual que al nacer.
   *
   * Copiar la del motivo tal cual dejaba que un caso escalado a seguridad volviera a `NORMAL` —y a
   * la vista de cualquier agente— con sólo cambiarle la categoría. Bajarla queda para un supervisor,
   * que es quien responde de la decisión; para el resto, reclasificar sólo puede endurecer.
   */
  private triagedSensitivity(actor: SupportActor, current: string, caseType: string, categorySensitivity?: string | null) {
    const proposed = sensitivityFor(caseType as SupportCaseType, categorySensitivity ?? current);
    return actor.isSupervisor ? proposed : strictestSensitivity(current, proposed);
  }
}
