/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { createStableCode, sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerEligibilityRepository } from '../../customers/repositories/customer-eligibility.repository.js';
import { evaluateProductEligibility } from './credit-product-eligibility.js';
import { CreditUnderwritingService } from './credit-underwriting.service.js';
import { CreateCreditApplicationDto } from '../credit.schemas.js';
import { CreditRepository } from '../credit.repository.js';

/**
 * Creación de la solicitud de crédito.
 *
 * Es el punto donde toda la cadena anterior tiene que sostenerse. La regla que lo gobierna es
 * simple y no negociable: **la elegibilidad se vuelve a evaluar aquí, en el servidor, antes de
 * escribir nada**. Que el frontend oculte el botón "Solicitar crédito" es experiencia de usuario; la
 * garantía es esta reevaluación, porque un cliente puede quedar inelegible entre que se pintó la
 * pantalla y que llegó el request —un caso de fraude abierto, un consentimiento revocado, un
 * documento vencido— y porque nada impide llamar al endpoint directamente.
 *
 * La evaluación que autoriza la solicitud se guarda junto a ella: `eligibility_evaluation_id` apunta
 * a la fila concreta y `eligibility_snapshot_json` congela su resultado.
 */
@Injectable()
export class CreditApplicationService {
  constructor(
    private readonly creditRepository: CreditRepository,
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
    private readonly underwriting: CreditUnderwritingService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async createApplication(input: {
    tenantId: string;
    customerId: string;
    body: CreateCreditApplicationDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const created = await this.persistApplication(input);

    // El motor se consulta DESPUÉS de confirmar la transacción: es E/S de red, y sostenerla dentro
    // dejaría una transacción abierta durante la respuesta de un sistema ajeno. Un producto marcado
    // para revisión manual no se automatiza — esa marca es una decisión de negocio, no un defecto.
    if (created.status !== 'submitted') return created;

    const decided = await this.underwriting.underwrite({
      tenantId: input.tenantId,
      applicationId: created.applicationId,
      customerId: input.customerId,
      applicationCode: created.applicationCode,
      requestedAmount: created.requestedAmount,
      requestedTermMonths: created.requestedTermMonths,
      currencyCode: created.currencyCode,
      productCode: created.productCode,
      purposeCode: created.purposeCode,
    });

    return { ...created, status: decided.status, decisionMode: decided.decisionMode, executionId: decided.executionId };
  }

  private async persistApplication(input: {
    tenantId: string;
    customerId: string;
    body: CreateCreditApplicationDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    const now = new Date();

    try {
      return await this.sequelize.transaction(async (transaction) => {
        const admission = await this.admitApplication(input, now, transaction);
        const { product, evaluation, latestEvaluation } = admission;

        const application = await this.creditRepository.createApplication(
          {
            tenantId: input.tenantId,
            applicationCode: createStableCode('CRA'),
            customerId: input.customerId,
            creditProductId: String(product.id),
            requestedAmount: input.body.requestedAmount.toFixed(2),
            requestedTermMonths: input.body.requestedTermMonths,
            currencyCode: product.currencyCode,
            purposeCode: input.body.purposeCode ?? null,
            status: product.requiresManualReview ? 'under_review' : 'submitted',
            eligibilityEvaluationId: latestEvaluation ? String(latestEvaluation.id) : null,
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
          },
          { transaction },
        );

        await this.creditRepository.createApplicationEvent(
          {
            tenantId: input.tenantId,
            creditApplicationId: String(application.id),
            eventType: 'submitted',
            previousStatus: null,
            newStatus: application.status,
            actorType: input.currentUser.role,
            actorInternalUserId: input.currentUser.internalUserId ?? null,
            reasonCode: 'credit_application_submitted',
            payloadJson: {
              productCode: product.productCode,
              requestedTermMonths: input.body.requestedTermMonths,
              eligibilityEvaluationId: latestEvaluation ? String(latestEvaluation.id) : null,
            },
            notes: null,
            happenedAt: now,
          },
          { transaction },
        );

        return {
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
        };
      });
    } catch (error) {
      // El índice único parcial es la garantía real contra dos solicitudes vivas simultáneas: el
      // chequeo previo puede perder la carrera. Se traduce al mismo error de negocio para que el
      // cliente reciba siempre la misma respuesta, gane o pierda la carrera.
      if (error instanceof UniqueConstraintError) throw new ConflictException('CREDIT_APPLICATION_ALREADY_OPEN');
      throw error;
    }
  }

  /**
   * Todas las puertas que una solicitud debe pasar ANTES de que se escriba una sola fila.
   *
   * Están juntas y separadas de la escritura a propósito: son la parte que decide si se admite, y
   * leerlas de corrido —producto ofertable, elegibilidad del producto, ninguna solicitud viva,
   * elegibilidad del cliente reevaluada en servidor— es lo que permite auditar el criterio sin
   * atravesar la construcción de las filas. Cualquiera de ellas lanza; si vuelve, la solicitud entra.
   */
  private async admitApplication(
    input: { tenantId: string; customerId: string; body: CreateCreditApplicationDto; currentUser: AuthenticatedUser },
    now: Date,
    transaction: Transaction,
  ) {
    const product = await this.creditRepository.findProductById(input.tenantId, input.body.productId, { transaction });
    if (!product) throw new NotFoundException('CREDIT_PRODUCT_NOT_FOUND');
    assertProductIsOfferable(product, now);

    // Elegibilidad POR PRODUCTO: rangos de monto/plazo e ingreso mínimo declarado. Es una capa
    // distinta de la habilitación general — un cliente habilitado puede no alcanzar el umbral de
    // ESTE producto y sí el de otro. `min_monthly_income` estaba declarado en el modelo desde el
    // principio y no lo evaluaba nadie.
    const facts = await this.eligibilityRepository.loadFacts(input.tenantId, input.customerId);
    const productBlockers = evaluateProductEligibility(product, input.body, facts.financialAttributeValues);
    if (productBlockers.length > 0) {
      throw new UnprocessableEntityException(productBlockers.map((blocker) => `${blocker.code}: ${blocker.detail}`).join(' · '));
    }

    const existing = await this.creditRepository.findOpenApplication(input.tenantId, input.customerId, { transaction });
    if (existing) throw new ConflictException('CREDIT_APPLICATION_ALREADY_OPEN');

    // Reevaluación server-side. Persiste la evidencia y devuelve los bloqueadores vigentes.
    const evaluation = await this.eligibilityService.evaluateAndRecord({
      tenantId: input.tenantId,
      customerId: input.customerId,
      evaluatedByType: input.currentUser.role,
      evaluatedByInternalUserId: input.currentUser.internalUserId ?? null,
      decisionSource: 'automatic',
      reasonCode: 'credit_application_requested',
      transaction,
    });

    if (!evaluation.eligible) {
      // Nada se persiste como solicitud: el intento queda registrado en la evaluación, que ya se
      // escribió, de modo que un cliente que insiste sin cumplir deja rastro sin crear ruido.
      throw new UnprocessableEntityException(`CUSTOMER_NOT_ELIGIBLE: ${evaluation.blockers.map((blocker) => blocker.code).join(', ')}`);
    }

    const latestEvaluation = await this.eligibilityService.getLatestEvaluation(input.tenantId, input.customerId);
    return { product, evaluation, latestEvaluation };
  }

  async listApplications(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const applications = await this.creditRepository.findApplicationsByCustomer(input.tenantId, input.customerId);
    return {
      customerId: input.customerId,
      applications: applications.map((application) => ({
        applicationId: String(application.id),
        applicationCode: application.applicationCode,
        status: application.status,
        requestedAmount: application.requestedAmount,
        requestedTermMonths: application.requestedTermMonths,
        currencyCode: application.currencyCode,
        submittedAt: application.submittedAt.toISOString(),
        decidedAt: application.decidedAt?.toISOString() ?? null,
        // `decision_reason_code` sí se expone: el cliente tiene derecho a saber por qué.
        decisionReasonCode: application.decisionReasonCode,
      })),
    };
  }
}

function assertProductIsOfferable(product: { status: string; effectiveFrom: Date | null; effectiveUntil: Date | null }, now: Date): void {
  if (product.status !== 'active') throw new UnprocessableEntityException('CREDIT_PRODUCT_NOT_AVAILABLE');
  if (product.effectiveFrom && product.effectiveFrom.getTime() > now.getTime()) {
    throw new UnprocessableEntityException('CREDIT_PRODUCT_NOT_AVAILABLE');
  }
  if (product.effectiveUntil && product.effectiveUntil.getTime() <= now.getTime()) {
    throw new UnprocessableEntityException('CREDIT_PRODUCT_NOT_AVAILABLE');
  }
}
