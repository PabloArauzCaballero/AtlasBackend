import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CustomersRepository } from '../customers/customers.repository.js';
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
    private readonly customersRepository: CustomersRepository,
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
      // Auditoría de producción (ver docs/audit/fraud.md, hallazgo 1): antes se hasheaba
      // `fraudCase.customerId` (el id interno autoincremental) como "entityHash", con
      // `entityType` fijo en `'customer'`. Un watchlist así construido NUNCA puede volver a
      // producir un match: un futuro registro fraudulento del mismo actor real recibe un
      // `customerId` distinto por diseño, así que hashear el id no protege contra nada — el
      // control quedaba silenciosamente inerte pese a reportar `watchlistApplied: true`. Ahora
      // se usan los hashes reales de teléfono/email del cliente (los mismos que ya se comparan
      // en el resto del sistema para detectar duplicados, ver `customers.repository.ts`), que sí
      // persisten si el mismo actor vuelve a registrarse con una identidad nueva.
      let watchlistApplied = false;
      if (input.body.applyWatchlist && fraudCase.customerId) {
        const customer = await this.customersRepository.findById(input.tenantId, String(fraudCase.customerId));
        const identifiers: Array<{ entityType: string; entityHash: string; entityLast4: string | null }> = [];
        if (customer?.primaryPhoneHash) {
          identifiers.push({ entityType: 'phone', entityHash: customer.primaryPhoneHash, entityLast4: customer.primaryPhoneLast4 });
        }
        if (customer?.primaryEmailHash) {
          identifiers.push({ entityType: 'email', entityHash: customer.primaryEmailHash, entityLast4: null });
        }

        for (const identifier of identifiers) {
          await this.fraudRepository.createWatchlistEntry(
            {
              tenantId: input.tenantId,
              entityType: identifier.entityType,
              entityHash: identifier.entityHash,
              entityLast4: identifier.entityLast4,
              reasonCode: input.body.reasonCode,
              severity: fraudCase.severity ?? 'high',
              actorInternalUserId: input.currentUser.internalUserId ?? null,
              createdAt: now,
            },
            { transaction },
          );
        }
        watchlistApplied = identifiers.length > 0;
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
            actorInternalUserId: input.currentUser.internalUserId ?? null,
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
