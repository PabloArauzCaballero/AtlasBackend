/**
 * @file Caso de uso: presentar una solicitud de crédito (AT-026).
 * @business Las puertas de admisión —producto ofertable, elegibilidad por producto, ninguna solicitud
 *   viva, comercio válido, elegibilidad del cliente reevaluada en servidor— y la escritura de la
 *   solicitud con la evaluación exacta que la autorizó. Una denegación deja evidencia y no solicitud.
 * @system Depende SOLO de puertos: `CreditUnitOfWork` (sesión con tienda de solicitudes y admisión de
 *   Clientes, ligadas a una transacción), `PartnerResolutionPort` y `Clock`. Sin Nest, sin Sequelize,
 *   sin HTTP: los errores son `ApplicationError`. La lógica es la misma que tenía
 *   `CreditApplicationAdmissionService`; los mensajes públicos no cambian.
 */
import { createStableCode, sha256Hex } from '../../../../common/utils/crypto/hash.util.js';
import { ApplicationError } from '../../../../platform/contracts/application-error.js';
import type { Clock } from '../../../../platform/di/clock.js';
import type { RecordedEligibility } from '../../../customers/application/customer-eligibility.service.js';
import type { CreateCreditApplicationDto } from '../../credit.schemas.js';
import { evaluateProductEligibility } from '../credit-product-eligibility.js';
import type { CreditUnitOfWork, CreditWorkSession } from '../ports/credit-unit-of-work.port.js';
import type { PartnerResolutionPort } from '../ports/partner-resolution.port.js';

export type SubmitCreditApplicationInput = Readonly<{
  tenantId: string;
  customerId: string;
  body: CreateCreditApplicationDto;
  actor: Readonly<{ role: string; internalUserId: string | null }>;
  idempotencyKey: string;
}>;

export type SubmittedCreditApplication = Readonly<{
  applicationId: string;
  applicationCode: string;
  customerId: string;
  productCode: string;
  status: string;
  requestedAmount: string;
  requestedTermMonths: number;
  currencyCode: string;
  submittedAt: string;
  purposeCode: string | null;
  /** La evaluación exacta que autorizó la solicitud (AT-006). */
  eligibilityEvaluationId: string;
}>;

export type SubmitOutcome = Readonly<
  { admitted: true; application: SubmittedCreditApplication } | { admitted: false; evaluation: RecordedEligibility }
>;

export function denialError(evaluation: RecordedEligibility): ApplicationError {
  const codes = evaluation.blockers.map((blocker) => blocker.code);
  return new ApplicationError({
    kind: 'unprocessable',
    code: 'CUSTOMER_NOT_ELIGIBLE',
    publicDetail: codes.join(', '),
    details: { blockers: codes },
  });
}

function assertProductIsOfferable(product: { status: string; effectiveFrom: Date | null; effectiveUntil: Date | null }, now: Date): void {
  const unavailable = () => new ApplicationError({ kind: 'unprocessable', code: 'CREDIT_PRODUCT_NOT_AVAILABLE' });
  if (product.status !== 'active') throw unavailable();
  if (product.effectiveFrom && product.effectiveFrom.getTime() > now.getTime()) throw unavailable();
  if (product.effectiveUntil && product.effectiveUntil.getTime() <= now.getTime()) throw unavailable();
}

export class SubmitCreditApplicationUseCase {
  constructor(
    private readonly unitOfWork: CreditUnitOfWork,
    private readonly partners: PartnerResolutionPort,
    private readonly clock: Clock,
  ) {}

  /**
   * Devuelve el resultado; NO lanza por denegación de negocio. La traducción a error público la hace
   * la fachada fuera de la transacción (AT-008), con `denialError`.
   */
  async execute(input: SubmitCreditApplicationInput): Promise<SubmitOutcome> {
    const now = this.clock.now();
    return this.unitOfWork.run(async (session) => {
      const admission = await this.admit(session, input, now);
      if (!admission.admitted) return admission;

      const { product, evaluation, partnerProfileId, posTerminalId } = admission;
      const application = await session.applications.createApplication({
        tenantId: input.tenantId,
        applicationCode: createStableCode('CRA'),
        customerId: input.customerId,
        creditProductId: String(product.id),
        partnerProfileId,
        posTerminalId,
        requestedAmount: input.body.requestedAmount.toFixed(2),
        requestedTermMonths: input.body.requestedTermMonths,
        currencyCode: product.currencyCode,
        purposeCode: input.body.purposeCode ?? null,
        status: product.requiresManualReview ? 'under_review' : 'submitted',
        eligibilityEvaluationId: evaluation.evaluationId,
        eligibilitySnapshotJson: {
          ruleVersion: evaluation.ruleVersion,
          evaluatedAt: evaluation.evaluatedAt,
          lifecycleStatus: evaluation.lifecycleStatus,
          eligible: evaluation.eligible,
        },
        riskAssessmentRunId: null,
        decisionReasonCode: null,
        decidedAt: null,
        decidedByInternalUserId: null,
        idempotencyKeyHash: sha256Hex(input.idempotencyKey),
        submittedAt: now,
        createdAtValue: now,
        updatedAtValue: now,
        deleted: false,
      });
      await session.applications.createApplicationEvent({
        tenantId: input.tenantId,
        creditApplicationId: String(application.id),
        eventType: 'submitted',
        previousStatus: null,
        newStatus: application.status,
        actorType: input.actor.role,
        actorInternalUserId: input.actor.internalUserId,
        reasonCode: 'credit_application_submitted',
        payloadJson: {
          productCode: product.productCode,
          requestedTermMonths: input.body.requestedTermMonths,
          eligibilityEvaluationId: evaluation.evaluationId,
        },
        notes: null,
        happenedAt: now,
      });
      return {
        admitted: true,
        application: Object.freeze({
          applicationId: String(application.id),
          applicationCode: application.applicationCode,
          customerId: input.customerId,
          productCode: product.productCode,
          status: application.status,
          requestedAmount: application.requestedAmount,
          requestedTermMonths: application.requestedTermMonths,
          currencyCode: application.currencyCode,
          submittedAt: application.submittedAt.toISOString(),
          purposeCode: input.body.purposeCode ?? null,
          eligibilityEvaluationId: evaluation.evaluationId,
        }),
      };
    });
  }

  private async admit(session: CreditWorkSession, input: SubmitCreditApplicationInput, now: Date) {
    const product = await session.applications.findProductById(input.tenantId, input.body.productId);
    if (!product) throw new ApplicationError({ kind: 'not_found', code: 'CREDIT_PRODUCT_NOT_FOUND' });
    assertProductIsOfferable(product, now);

    // Consistencia de hechos (AT-007): fila del cliente bloqueada y hechos leídos UNA vez en la sesión.
    await session.eligibility.lockCustomer(input.tenantId, input.customerId);
    const facts = await session.eligibility.loadFacts(input.tenantId, input.customerId);

    const productBlockers = evaluateProductEligibility(product, input.body, facts.financialAttributeValues);
    if (productBlockers.length > 0) {
      throw new ApplicationError({
        kind: 'unprocessable',
        code: productBlockers.map((blocker) => `${blocker.code}: ${blocker.detail}`).join(' · '),
      });
    }

    const existing = await session.applications.findOpenApplication(input.tenantId, input.customerId);
    if (existing) throw new ApplicationError({ kind: 'conflict', code: 'CREDIT_APPLICATION_ALREADY_OPEN' });

    const { partnerProfileId, posTerminalId } = await this.partners.resolve(
      input.tenantId,
      input.body.partnerProfileId,
      input.body.posTerminalId,
    );

    const evaluation = await session.eligibility.evaluateAndRecord({
      tenantId: input.tenantId,
      customerId: input.customerId,
      evaluatedByType: input.actor.role,
      evaluatedByInternalUserId: input.actor.internalUserId,
      decisionSource: 'automatic',
      reasonCode: 'credit_application_requested',
      facts,
    });
    if (!evaluation.eligible) return { admitted: false as const, evaluation };
    return { admitted: true as const, product, evaluation, partnerProfileId, posTerminalId };
  }
}
