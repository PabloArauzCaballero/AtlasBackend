import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { hashSensitiveText } from '../../common/utils/crypto/hash.util.js';
import { FraudRepository } from './fraud.repository.js';
import { FraudDecisionDto, FraudDecisionParamsDto } from './fraud.schemas.js';

/**
 * ATLAS-AUDIT-014 (cerrado en este patch): módulo `fraud` extraído de `operations`/`risk`.
 * Lógica idéntica a la que vivía en `OperationsService.decideFraudCase` — solo cambia de dónde
 * vive el código, no el comportamiento observable. La ruta HTTP se mantiene sin cambios en
 * `operations.controller.ts` (`POST /operations/fraud-cases/:caseId/decision`), que ahora
 * delega en este servicio.
 */
@Injectable()
export class FraudService {
  constructor(
    private readonly fraudRepository: FraudRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async decideFraudCase(input: {
    tenantId: string;
    params: FraudDecisionParamsDto;
    body: FraudDecisionDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    if ((input.body.decision === 'confirmed_fraud' || input.body.decision === 'blocked') && !input.body.reasonCode) {
      throw new UnprocessableEntityException('FRAUD_REASON_REQUIRED');
    }
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const fraudCase = await this.fraudRepository.findFraudCaseById(input.tenantId, input.params.caseId);
      if (!fraudCase) throw new NotFoundException('FRAUD_CASE_NOT_FOUND');
      if (fraudCase.closedAt || fraudCase.caseStatus === 'closed') throw new ConflictException('CASE_ALREADY_CLOSED');
      const caseStatus = input.body.decision === 'needs_more_investigation' ? 'in_progress' : 'closed';
      await this.fraudRepository.closeFraudCase(
        fraudCase,
        { resolution: input.body.decision, notes: input.body.notes ?? null, closedAt: now, nextStatus: caseStatus },
        { transaction },
      );
      await this.fraudRepository.createFraudCaseEvent(
        {
          tenantId: input.tenantId,
          caseId: input.params.caseId,
          eventType: 'fraud_decision_recorded',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          payload: { decision: input.body.decision, reasonCode: input.body.reasonCode, applyWatchlist: input.body.applyWatchlist },
          notes: input.body.notes ?? null,
          happenedAt: now,
        },
        { transaction },
      );
      let watchlistApplied = false;
      if (input.body.applyWatchlist) {
        await this.fraudRepository.createWatchlistEntry(
          {
            tenantId: input.tenantId,
            entityType: 'customer',
            entityHash: fraudCase.customerId ? hashSensitiveText(String(fraudCase.customerId)) : null,
            reasonCode: input.body.reasonCode,
            severity: fraudCase.severity ?? 'high',
            actorInternalUserId: input.currentUser.internalUserId ?? null,
            createdAt: now,
          },
          { transaction },
        );
        watchlistApplied = true;
      }
      if (fraudCase.customerId && input.body.nextCustomerStatus) {
        await this.fraudRepository.createStatusEvent(
          {
            tenantId: input.tenantId,
            customerId: String(fraudCase.customerId),
            previousStatus: null,
            newStatus: input.body.nextCustomerStatus,
            reasonCode: input.body.reasonCode,
            actorType: input.currentUser.role,
            happenedAt: now,
            notes: input.body.notes ?? null,
          },
          { transaction },
        );
        await this.fraudRepository.createCustomerObservation(
          {
            tenantId: input.tenantId,
            customerId: String(fraudCase.customerId),
            observationCode: 'fraud_decision',
            payload: { decision: input.body.decision, reasonCode: input.body.reasonCode, watchlistApplied },
            happenedAt: now,
          },
          { transaction },
        );
      }
      await this.fraudRepository.createOperationalAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'operations.fraud.decision',
          targetType: 'fraud_case',
          targetId: input.params.caseId,
          payload: { decision: input.body.decision, reasonCode: input.body.reasonCode, watchlistApplied },
          happenedAt: now,
        },
        { transaction },
      );
      await this.fraudRepository.createDataChange(
        {
          tenantId: input.tenantId,
          tableName: 'fraud_cases',
          recordId: input.params.caseId,
          changeType: 'decision',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          reason: input.body.reasonCode,
          happenedAt: now,
        },
        { transaction },
      );
      return {
        caseId: input.params.caseId,
        customerId: fraudCase.customerId ? String(fraudCase.customerId) : null,
        decision: input.body.decision,
        caseStatus,
        watchlistApplied,
        nextCustomerStatus: input.body.nextCustomerStatus ?? null,
      };
    });
  }
}
