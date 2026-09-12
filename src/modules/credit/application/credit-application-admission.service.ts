/**
 * @file Qué se escribe al recibir una solicitud, y si se admite a evaluación.
 * @business Esta pieza deja trazabilidad de la atención y su resultado.
 * @system implementa este tramo del caso de uso de soporte.
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';

import { createStableCode, sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerEligibilityRepository } from '../../customers/repositories/customer-eligibility.repository.js';
import type { RecordedEligibility } from '../../customers/application/customer-eligibility.service.js';
import { PartnerDirectoryService } from '../../partner-onboarding/application/partner-directory.service.js';
import { PartnerProfileService } from '../../partner-onboarding/application/partner-profile.service.js';
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

/**
 * Sale de `CreditApplicationService` porque aquel archivo mezclaba la respuesta que se le da a
 * quien solicita con lo que ocurre por debajo: la escritura de la solicitud, la decisión de
 * admitirla y de qué comercio viene. Juntos pasaban del límite de `check:file-size`.
 */
import { assertProductIsOfferable, toSubmissionResponse } from './credit-application.shared.js';
import { ApplicationError, toHttpException } from '../../../platform/contracts/application-error.js';

/**
 * La denegación como error de aplicación (AT-013): sin transporte. Mismo mensaje público de siempre
 * (`CUSTOMER_NOT_ELIGIBLE: A, B`); `toHttpException` lo convierte en 422 en la frontera.
 */
export function denialError(evaluation: RecordedEligibility): ApplicationError {
  const codes = evaluation.blockers.map((blocker) => blocker.code);
  return new ApplicationError({
    kind: 'unprocessable',
    code: 'CUSTOMER_NOT_ELIGIBLE',
    publicDetail: codes.join(', '),
    details: { blockers: codes },
  });
}
/**
 * Resultado de las puertas de admisión. Una denegación de negocio es un RESULTADO, no una excepción:
 * así la transacción que escribió la evidencia puede confirmarse, y sólo los fallos técnicos (una
 * escritura que falla, una restricción violada) siguen provocando rollback.
 */
export type AdmissionOutcome =
  | { admitted: false; evaluation: RecordedEligibility }
  | {
      admitted: true;
      product: NonNullable<Awaited<ReturnType<CreditRepository['findProductById']>>>;
      evaluation: RecordedEligibility;
      partnerProfileId: string | null;
      posTerminalId: string | null;
    };

/** Lo que sale del callback transaccional: la denegación confirmada o la solicitud escrita. */
type PersistOutcome =
  { admitted: false; evaluation: RecordedEligibility } | { admitted: true; response: ReturnType<typeof toSubmissionResponse> };

@Injectable()
export class CreditApplicationAdmissionService {
  constructor(
    private readonly creditRepository: CreditRepository,
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
    private readonly underwriting: CreditUnderwritingService,
    private readonly partnerProfiles: PartnerProfileService,
    private readonly partnerDirectory: PartnerDirectoryService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async persistApplication(input: {
    tenantId: string;
    customerId: string;
    body: CreateCreditApplicationDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    const now = new Date();

    let outcome: PersistOutcome;
    try {
      outcome = await this.sequelize.transaction(async (transaction) => {
        const admission = await this.admitApplication(input, now, transaction);
        // Denegación prevista: se CONFIRMA la evidencia (la evaluación ya está escrita en esta
        // transacción) y no se crea solicitud. Lanzar aquí revertía esa evidencia —el comentario
        // que había decía «ya se escribió» y el rollback del callback gestionado lo desmentía— y
        // dejaba sin rastro al cliente que insiste sin cumplir (AT-008).
        if (!admission.admitted) return admission;
        return this.persistAdmitted(input, now, transaction, admission);
      });
    } catch (error) {
      // El índice único parcial es la garantía real contra dos solicitudes vivas simultáneas: el
      // chequeo previo puede perder la carrera. Se traduce al mismo error de negocio para que el
      // cliente reciba siempre la misma respuesta, gane o pierda la carrera.
      if (error instanceof UniqueConstraintError) throw new ConflictException('CREDIT_APPLICATION_ALREADY_OPEN');
      throw error;
    }

    if (!outcome.admitted) throw toHttpException(denialError(outcome.evaluation));
    return outcome.response;
  }

  /**
   * Escribe la solicitud admitida y su evento. Sólo se llama con una admisión ya decidida y dentro
   * de la transacción que escribió la evaluación: `eligibilityEvaluationId` es la fila EXACTA que
   * autorizó esta solicitud, no «la última» leída después (AT-006).
   */
  private async persistAdmitted(
    input: {
      tenantId: string;
      customerId: string;
      body: CreateCreditApplicationDto;
      currentUser: AuthenticatedUser;
      idempotencyKey: string;
    },
    now: Date,
    transaction: Transaction,
    admission: Extract<AdmissionOutcome, { admitted: true }>,
  ): Promise<Extract<PersistOutcome, { admitted: true }>> {
    const { product, evaluation, partnerProfileId, posTerminalId } = admission;
    const application = await this.creditRepository.createApplication(
      {
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
          eligibilityEvaluationId: evaluation.evaluationId,
        },
        notes: null,
        happenedAt: now,
      },
      { transaction },
    );

    return { admitted: true, response: toSubmissionResponse(application, product.productCode, input) };
  }

  /**
   * Todas las puertas que una solicitud debe pasar ANTES de que se escriba una sola fila.
   *
   * Están juntas y separadas de la escritura a propósito: son la parte que decide si se admite, y
   * leerlas de corrido —producto ofertable, elegibilidad del producto, ninguna solicitud viva,
   * elegibilidad del cliente reevaluada en servidor— es lo que permite auditar el criterio sin
   * atravesar la construcción de las filas. Cualquiera de ellas lanza; si vuelve, la solicitud entra.
   */
  async admitApplication(
    input: { tenantId: string; customerId: string; body: CreateCreditApplicationDto; currentUser: AuthenticatedUser },
    now: Date,
    transaction: Transaction,
  ): Promise<AdmissionOutcome> {
    const product = await this.creditRepository.findProductById(input.tenantId, input.body.productId, { transaction });
    if (!product) throw new NotFoundException('CREDIT_PRODUCT_NOT_FOUND');
    assertProductIsOfferable(product, now);

    /*
     * Consistencia de hechos (AT-007): la fila del cliente se bloquea (`FOR UPDATE`) durante la
     * admisión. Las transiciones de ciclo de vida toman el mismo bloqueo, así que un bloqueo o
     * cierre de cuenta concurrente espera a que esta admisión termine y luego ve la solicitud, o
     * termina antes y esta admisión lee el estado nuevo; nunca se admite sobre un estado que ya no
     * existe. Los hechos se leen UNA vez dentro de la transacción y alimentan tanto la elegibilidad
     * por producto como la general. Lo que NO cubre el bloqueo —consentimientos, casos de fraude,
     * resultados de riesgo escritos sin tocar la fila del cliente— queda documentado en
     * docs/architecture/microservices/admission-consistency.md.
     */
    await this.eligibilityService.lockCustomerForDecision(input.tenantId, input.customerId, transaction);

    // Elegibilidad POR PRODUCTO: rangos de monto/plazo e ingreso mínimo declarado. Es una capa
    // distinta de la habilitación general — un cliente habilitado puede no alcanzar el umbral de
    // ESTE producto y sí el de otro. `min_monthly_income` estaba declarado en el modelo desde el
    // principio y no lo evaluaba nadie.
    const facts = await this.eligibilityRepository.loadFacts(input.tenantId, input.customerId, { transaction });
    const productBlockers = evaluateProductEligibility(product, input.body, facts.financialAttributeValues);
    if (productBlockers.length > 0) {
      throw new UnprocessableEntityException(productBlockers.map((blocker) => `${blocker.code}: ${blocker.detail}`).join(' · '));
    }

    const existing = await this.creditRepository.findOpenApplication(input.tenantId, input.customerId, { transaction });
    if (existing) throw new ConflictException('CREDIT_APPLICATION_ALREADY_OPEN');

    /*
     * El comercio donde nace la compra, comprobado aquí y no dado por bueno. El identificador lo
     * manda el cliente —lo resolvió antes escaneando el QR—, así que aceptarlo sin mirar dejaría
     * atribuir un crédito a cualquier comercio del tenant, y con él su categoría de gasto y su
     * aceptación pendiente. Que el QR se resolviera en el servidor no basta: entre aquella
     * respuesta y esta petición no hay nada que ate las dos.
     */
    const { partnerProfileId, posTerminalId } = await this.resolvePartner(
      input.tenantId,
      input.body.partnerProfileId,
      input.body.posTerminalId,
    );

    // Reevaluación server-side sobre los MISMOS hechos. Persiste la evidencia y devuelve los
    // bloqueadores vigentes junto con la identidad exacta de la fila escrita.
    const evaluation = await this.eligibilityService.evaluateAndRecord({
      tenantId: input.tenantId,
      customerId: input.customerId,
      evaluatedByType: input.currentUser.role,
      evaluatedByInternalUserId: input.currentUser.internalUserId ?? null,
      decisionSource: 'automatic',
      reasonCode: 'credit_application_requested',
      transaction,
      facts,
    });

    // Nada se persiste como solicitud: el intento queda registrado en la evaluación, que quien
    // llama confirma al cerrar la transacción, de modo que un cliente que insiste sin cumplir deja
    // rastro sin crear ruido. La traducción a error HTTP ocurre FUERA del callback transaccional.
    if (!evaluation.eligible) return { admitted: false, evaluation };

    return { admitted: true, product, evaluation, partnerProfileId, posTerminalId };
  }

  /**
   * Comprueba el comercio declarado, si lo hay.
   *
   * Devuelve `null` cuando no viene: una solicitud puede nacer fuera de un comercio —una renovación,
   * un alta desde el portal interno— y forzar un valor ahí inventaría el origen del gasto, que es
   * justo el dato que el tablero por categoría necesita que sea cierto.
   *
   * Un expediente no aprobado se rechaza como comercio no disponible y no como «no encontrado»: la
   * diferencia importa para quien depura, y para el cliente ninguna de las dos cambia lo que puede
   * hacer.
   */
  async resolvePartner(
    tenantId: string,
    partnerProfileId: string | undefined,
    posTerminalId: string | undefined,
  ): Promise<{ partnerProfileId: string | null; posTerminalId: string | null }> {
    if (!partnerProfileId) return { partnerProfileId: null, posTerminalId: null };

    const profile = await this.partnerProfiles.requireProfile(tenantId, partnerProfileId);
    if (profile.onboardingStatus !== 'approved') throw new UnprocessableEntityException('PARTNER_NOT_AVAILABLE');

    // El terminal se ata sólo si es de ESTE comercio. Un id de otro se ignora en silencio: la compra
    // se queda sin caja registrada, que es preferible a atribuirla a una sucursal equivocada.
    let terminalId: string | null = null;
    if (posTerminalId) {
      const terminal = await this.partnerDirectory.findOwnedTerminal(tenantId, String(profile.id), posTerminalId);
      terminalId = terminal ? String(terminal.id) : null;
    }
    return { partnerProfileId: String(profile.id), posTerminalId: terminalId };
  }
}
