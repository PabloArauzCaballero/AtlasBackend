/**
 * @file Lo que queda ESCRITO al abrirse un caso: su bitácora y el evento de dominio.
 * @business Esta pieza deja trazabilidad de la atención y su resultado.
 * @system implementa este tramo del caso de uso de soporte.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { SupportCaseModel } from '../../../database/models/index.js';

import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';

import { NEVER_AUTO_CLOSE_CASE_TYPES, type SupportCaseType } from '../support.constants.js';

import type { OpenCaseInput } from './support-case-factory.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseFactoryService } from './support-case-factory.service.js';
import { SupportSlaService } from './support-sla.service.js';

/**
 * Sale de `SupportCaseService` porque aquel archivo mezclaba la decisión de abrir un caso —qué
 * cola, qué categoría, qué sujeto— con el rastro que esa apertura deja. Juntos pasaban de las 300
 * líneas de `check:file-size`, y son dos cosas que se leen en momentos distintos: una al preguntar
 * «¿por qué acabó este caso aquí?» y otra al preguntar «¿quién se enteró?».
 */
@Injectable()
export class SupportCaseCreationEventsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly catalog: SupportCatalogRepository,
    private readonly cases: SupportCaseRepository,
    private readonly sla: SupportSlaService,
    private readonly audit: SupportAuditService,
    private readonly factory: SupportCaseFactoryService,
    private readonly actors: SupportActorService,
  ) {}

  async recordCreationEvents(input: {
    input: OpenCaseInput;
    caseId: string;
    caseNumber: string;
    category: { categoryCode: string };
    caseType: SupportCaseType;
    priority: string;
    queueCode: string | null;
    channelId: string;
    transaction: Transaction;
  }): Promise<void> {
    const { transaction, caseId, caseType, priority } = input;
    const tenantId = input.input.tenantId;
    const correlationId = input.input.correlationId ?? null;

    await this.cases.appendEvent(
      {
        tenantId,
        caseId,
        eventType: 'CASE_CREATED',
        actorType: input.input.actor.actorType,
        actorId: input.input.actor.actorId,
        payload: { caseNumber: input.caseNumber, caseType, priority, categoryCode: input.category.categoryCode },
        correlationId,
      },
      transaction,
    );

    await this.cases.appendEvent(
      {
        tenantId,
        caseId,
        eventType: 'CASE_TRIAGED',
        actorType: 'SYSTEM',
        actorId: null,
        payload: {
          automatic: true,
          classifiedBy: 'REQUESTER',
          categoryCode: input.category.categoryCode,
          caseType,
          priority,
          queueCode: input.queueCode,
          reason: 'Clasificación declarada por quien abrió el caso; pendiente de validación por un agente.',
        },
        correlationId,
      },
      transaction,
    );

    await this.cases.appendEvent(
      {
        tenantId,
        caseId,
        eventType: 'CHANNEL_OPENED',
        actorType: 'SYSTEM',
        actorId: null,
        payload: { channelId: input.channelId, channelType: 'ASYNC_MESSAGING' },
      },
      transaction,
    );
  }

  async publishCreation(tenantId: string, supportCase: SupportCaseModel, caseType: SupportCaseType, correlationId: string | null) {
    const caseId = String(supportCase.id);
    await this.audit.publish({
      tenantId,
      eventCode: 'support.case.created',
      aggregateType: 'support_case',
      aggregateId: caseId,
      payload: { caseNumber: supportCase.caseNumber, caseType, priority: supportCase.priority },
      idempotencyKey: `support-case-created-${caseId}`,
      correlationId,
    });

    if (caseType === 'COMPLAINT') {
      await this.audit.publish({
        tenantId,
        eventCode: 'support.complaint.created',
        aggregateType: 'support_case',
        aggregateId: caseId,
        payload: { caseNumber: supportCase.caseNumber },
        idempotencyKey: `support-complaint-created-${caseId}`,
      });
    }
    if (NEVER_AUTO_CLOSE_CASE_TYPES.includes(caseType) && caseType !== 'COMPLAINT') {
      await this.audit.publish({
        tenantId,
        eventCode: 'support.security.escalated',
        aggregateType: 'support_case',
        aggregateId: caseId,
        payload: { caseNumber: supportCase.caseNumber, caseType },
        idempotencyKey: `support-security-${caseId}`,
      });
    }
  }
}
