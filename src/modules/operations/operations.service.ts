/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
 * @system gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { CustomerLifecycleService } from '../customers/application/customer-lifecycle.service.js';
import { CustomerContactsSnapshotService } from '../customer-onboarding/application/customer-contacts-snapshot.service.js';
import { CustomerLifecycleStatus } from '../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomerContactsRepository } from '../customers/repositories/customer-contacts.repository.js';
import { RiskRepository } from '../risk/risk.repository.js';
import { InvestigationSummaryResponseDto } from './operations.dtos.js';
import { toInvestigationSummaryResponse } from './operations.mapper.js';
import { OperationsRepository } from './operations.repository.js';
import { ManualReviewDecisionDto, ManualReviewDecisionParamsDto, OperationsCustomerIdParamsDto } from './operations.schemas.js';

// La decisión de fraude vive en FraudService; OperationsController conserva la ruta compatible.

import { assertDecidableFromPortal } from './manual-review-decision-guards.js';
@Injectable()
export class OperationsService {
  constructor(
    private readonly operationsRepository: OperationsRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly customerContactsRepository: CustomerContactsRepository,
    private readonly riskRepository: RiskRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    /*
     * La agenda del cliente la calcula y la guarda el módulo de ALTA, y de ahí se
     * lee. No se duplica la consulta aquí porque entonces habría dos definiciones
     * de qué significa «la agenda de este cliente» —una para decidir y otra para
     * investigar— y basta con que se separen una vez para que el analista vea unos
     * números y el motor decida con otros.
     */
    private readonly contactsSnapshot: CustomerContactsSnapshotService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  // La COLA (por página y por cursor) vive en `OperationsWorkQueueService`.

  async getInvestigationSummary(tenantId: string, params: OperationsCustomerIdParamsDto): Promise<InvestigationSummaryResponseDto> {
    const customer = await this.customersRepository.findById(tenantId, params.customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const [profile, contacts, consents, latestRiskResult, manualReviewCases, fraudCases, latestIdentityAttempt, addressBook] =
      await Promise.all([
        this.customersRepository.findCurrentProfile(tenantId, params.customerId),
        this.customerContactsRepository.findContactMethods(tenantId, params.customerId),
        this.customersRepository.findCustomerConsents(tenantId, params.customerId),
        this.riskRepository.findLatestCustomerRiskResult(tenantId, params.customerId),
        this.operationsRepository.findOpenManualReviewCasesForCustomer(tenantId, params.customerId),
        this.operationsRepository.findFraudCasesForCustomer(tenantId, params.customerId),
        this.operationsRepository.findLatestIdentityAttempt(tenantId, params.customerId),
        // La agenda es una lectura auxiliar: si falla, el expediente entero no puede
        // dejar de verse por ella. Degradar a «no disponible» es lo mismo que la
        // pantalla enseña cuando la persona no dio el permiso.
        this.contactsSnapshot.featuresFor(tenantId, params.customerId).catch(() => ({
          available: false,
          totalContacts: 0,
          uniqueRatio: 0,
          bolivianRatio: 0,
          referencesFoundInAddressBook: 0,
          riskMatches: 0,
        })),
      ]);

    return toInvestigationSummaryResponse({
      customer,
      profile,
      contacts,
      consents,
      latestRiskResult,
      manualReviewCases,
      fraudCases,
      latestIdentityAttempt,
      addressBook,
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
      const reviewCase = await this.operationsRepository.findManualReviewCaseById(input.tenantId, input.params.caseId, { transaction });
      if (!reviewCase) throw new NotFoundException('CASE_NOT_FOUND');
      if (reviewCase.closedAt || reviewCase.status === 'closed') throw new ConflictException('CASE_ALREADY_CLOSED');
      assertDecidableFromPortal(reviewCase);
      await this.operationsRepository.closeManualReviewCase(
        reviewCase,
        { resolution: input.body.decision, notes: input.body.notes ?? null, closedAt: now },
        { transaction },
      );
      await this.applyDecisionToRiskResult(input.tenantId, reviewCase.riskAssessmentRunId, input.body, now, transaction);
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
      // CORRECCIÓN (H1): antes esta rama insertaba el evento de historial con `previousStatus: null`
      // y NUNCA actualizaba `customers.lifecycle_status`. El historial decía "aprobado" y el cliente
      // seguía en su estado anterior; desde la primera decisión manual, estado e historial divergían.
      // Ahora la transición la aplica `CustomerLifecycleService`, que valida contra la máquina de
      // estados y escribe estado + evento (con el estado anterior REAL) en esta misma transacción.
      let appliedStatus: CustomerLifecycleStatus | null = null;
      if (reviewCase.customerId && input.body.nextCustomerStatus) {
        const transition = await this.lifecycleService.transition({
          tenantId: input.tenantId,
          customerId: String(reviewCase.customerId),
          toStatus: input.body.nextCustomerStatus,
          reasonCode: input.body.reasonCode,
          changedByType: input.currentUser.role,
          changedByInternalUserId: input.currentUser.internalUserId ?? null,
          notes: input.body.notes ?? null,
          transaction,
        });
        appliedStatus = transition.newStatus;
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
        nextCustomerStatus: appliedStatus,
      };
    });
  }

  /**
   * La decisión del analista se escribe TAMBIÉN en el resultado de riesgo del que nació el caso.
   *
   * La elegibilidad lee `latestRisk.recommendedAction`, no el estado del caso: cerrar el caso como
   * «approved» sin tocar el resultado dejaba al cliente en `RISK_NOT_APPROVED` para siempre —
   * medido el 2026-09-15 en TEST con el recorrido completo, con el caso aprobado y el crédito
   * rechazado igual. El callback del Motor ya hacía esto (`RiskManualReviewOutcomeService`); el
   * camino humano del portal, no. Sólo «approved» y «rejected» cambian la recomendación; pedir más
   * información, escalar a fraude o no actuar la dejan como estaba.
   */
  private async applyDecisionToRiskResult(
    tenantId: string,
    riskAssessmentRunId: string | null,
    body: ManualReviewDecisionDto,
    now: Date,
    transaction: Transaction,
  ): Promise<void> {
    if (!riskAssessmentRunId) return;
    const recommendedAction = body.decision === 'approved' ? 'approved_for_next_step' : body.decision === 'rejected' ? 'rejected' : null;
    if (!recommendedAction) return;
    const result = await this.riskRepository.findRiskResultByRun(tenantId, riskAssessmentRunId);
    if (!result) return;
    await this.riskRepository.applyManualReviewOutcome(result, { recommendedAction, reason: body.reasonCode, now }, { transaction });
  }
}
