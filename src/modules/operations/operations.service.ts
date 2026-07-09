import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { buildPaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { RiskRepository } from '../risk/risk.repository.js';
import { InvestigationSummaryResponseDto, PaginatedWorkQueueResponseDto } from './operations.dtos.js';
import { toFraudWorkItem, toInvestigationSummaryResponse, toManualReviewWorkItem } from './operations.mapper.js';
import { OperationsRepository } from './operations.repository.js';
import {
  ManualReviewDecisionDto,
  ManualReviewDecisionParamsDto,
  OperationsCustomerIdParamsDto,
  CursorWorkQueueQueryDto,
  WorkQueueQueryDto,
} from './operations.schemas.js';

// decideFraudCase se movió a src/modules/fraud/fraud.service.ts (ATLAS-AUDIT-014). La ruta
// HTTP `POST /operations/fraud-cases/:caseId/decision` sigue existiendo sin cambios — ver
// operations.controller.ts, que ahora delega en FraudService en vez de en OperationsService.

@Injectable()
export class OperationsService {
  constructor(
    private readonly operationsRepository: OperationsRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly riskRepository: RiskRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * ATLAS-P11-T10: variantes por cursor de las colas individuales (no combinadas — ver la nota
   * de alcance en `operations.repository.ts`). Pensadas para el panel de operaciones cuando el
   * volumen de casos crezca lo suficiente para que `OFFSET` se vuelva costoso.
   */
  async getManualReviewCasesCursorPage(tenantId: string, query: CursorWorkQueueQueryDto) {
    const result = await this.operationsRepository.findManualReviewCasesForQueueWithCursor(tenantId, query);
    return { items: result.items.map(toManualReviewWorkItem), nextCursor: result.nextCursor };
  }

  async getFraudCasesCursorPage(tenantId: string, query: CursorWorkQueueQueryDto) {
    const result = await this.operationsRepository.findFraudCasesForQueueWithCursor(tenantId, query);
    return { items: result.items.map(toFraudWorkItem), nextCursor: result.nextCursor };
  }

  async getWorkQueue(tenantId: string, query: WorkQueueQueryDto): Promise<PaginatedWorkQueueResponseDto> {
    if (query.queue === 'manual_review') {
      const result = await this.operationsRepository.findManualReviewCasesForQueue(tenantId, query);
      return {
        items: result.rows.map(toManualReviewWorkItem),
        meta: result.meta,
      };
    }

    if (query.queue === 'fraud') {
      const result = await this.operationsRepository.findFraudCasesForQueue(tenantId, query);
      return {
        items: result.rows.map(toFraudWorkItem),
        meta: result.meta,
      };
    }

    // queue === 'all': fetch both, merge by date, apply pagination in application layer
    const [manualResult, fraudResult] = await Promise.all([
      this.operationsRepository.findManualReviewCasesForQueue(tenantId, query),
      this.operationsRepository.findFraudCasesForQueue(tenantId, query),
    ]);

    const allItems = [...manualResult.rows.map(toManualReviewWorkItem), ...fraudResult.rows.map(toFraudWorkItem)].sort((a, b) => {
      const dateA = a.openedAt ?? a.createdAt;
      const dateB = b.openedAt ?? b.createdAt;
      return query.sortOrder === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    });

    const totalCount = manualResult.meta.total + fraudResult.meta.total;
    const start = (query.page - 1) * query.limit;

    return {
      items: allItems.slice(start, start + query.limit),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, totalCount),
    };
  }

  async getInvestigationSummary(tenantId: string, params: OperationsCustomerIdParamsDto): Promise<InvestigationSummaryResponseDto> {
    const customer = await this.customersRepository.findById(tenantId, params.customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const [profile, contacts, consents, latestRiskResult, manualReviewCases, fraudCases] = await Promise.all([
      this.customersRepository.findCurrentProfile(tenantId, params.customerId),
      this.customersRepository.findContactMethods(tenantId, params.customerId),
      this.customersRepository.findCustomerConsents(tenantId, params.customerId),
      this.riskRepository.findLatestCustomerRiskResult(tenantId, params.customerId),
      this.operationsRepository.findOpenManualReviewCasesForCustomer(tenantId, params.customerId),
      this.operationsRepository.findFraudCasesForCustomer(tenantId, params.customerId),
    ]);

    return toInvestigationSummaryResponse({
      customer,
      profile,
      contacts,
      consents,
      latestRiskResult,
      manualReviewCases,
      fraudCases,
    });
  }

  async decideManualReviewCase(input: {
    tenantId: string;
    params: ManualReviewDecisionParamsDto;
    body: ManualReviewDecisionDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    if ((input.body.decision === 'rejected' || input.body.decision === 'request_more_information') && !input.body.notes) {
      throw new UnprocessableEntityException('DECISION_REASON_REQUIRED');
    }
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const reviewCase = await this.operationsRepository.findManualReviewCaseById(input.tenantId, input.params.caseId);
      if (!reviewCase) throw new NotFoundException('CASE_NOT_FOUND');
      if (reviewCase.closedAt || reviewCase.status === 'closed') throw new ConflictException('CASE_ALREADY_CLOSED');
      await this.operationsRepository.closeManualReviewCase(
        reviewCase,
        { resolution: input.body.decision, notes: input.body.notes ?? null, closedAt: now },
        { transaction },
      );
      await this.operationsRepository.createManualReviewEvent(
        {
          tenantId: input.tenantId,
          caseId: input.params.caseId,
          eventType: 'decision_recorded',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          payload: {
            decision: input.body.decision,
            reasonCode: input.body.reasonCode,
            idempotencyKeyHash: sha256Hex(input.idempotencyKey),
          },
          notes: input.body.notes ?? null,
          happenedAt: now,
        },
        { transaction },
      );
      if (reviewCase.customerId && input.body.nextCustomerStatus) {
        await this.operationsRepository.createStatusEvent(
          {
            tenantId: input.tenantId,
            customerId: String(reviewCase.customerId),
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
        await this.operationsRepository.createCustomerObservation(
          {
            tenantId: input.tenantId,
            customerId: String(reviewCase.customerId),
            observationCode: 'manual_review_decision',
            payload: { decision: input.body.decision, reasonCode: input.body.reasonCode },
            happenedAt: now,
          },
          { transaction },
        );
      }
      await this.operationsRepository.createOperationalAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'operations.manual_review.decision',
          targetType: 'manual_review_case',
          targetId: input.params.caseId,
          payload: { decision: input.body.decision, reasonCode: input.body.reasonCode },
          happenedAt: now,
        },
        { transaction },
      );
      await this.operationsRepository.createDataChange(
        {
          tenantId: input.tenantId,
          tableName: 'manual_review_cases',
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
        customerId: reviewCase.customerId ? String(reviewCase.customerId) : null,
        decision: input.body.decision,
        caseStatus: 'closed',
        nextCustomerStatus: input.body.nextCustomerStatus ?? null,
      };
    });
  }
}
