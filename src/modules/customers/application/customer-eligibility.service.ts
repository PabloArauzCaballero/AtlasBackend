/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../customers.repository.js';
import { CustomerLifecycleStatus, normalizeLifecycleStatus } from '../customer-lifecycle.constants.js';
import { CustomerEligibilityRepository } from '../repositories/customer-eligibility.repository.js';
import type { EligibilityFacts } from '../repositories/customer-eligibility.facts.js';
import { CustomerLifecycleRepository } from '../repositories/customer-lifecycle.repository.js';
import { CustomerLifecycleService } from './customer-lifecycle.service.js';
import { EligibilityAssessment, assess } from './customer-eligibility.evaluator.js';

export type EligibilityResponse = EligibilityAssessment & { evaluatedAt: string };

/**
 * Lo que devuelve `evaluateAndRecord`: la respuesta pública MÁS la identidad de la fila de evidencia
 * que acaba de escribir. Quien enlaza una decisión a su evaluación (la admisión de crédito) usa ese
 * `evaluationId`; quien responde HTTP lo omite con `toEligibilityResponse`, para que el contrato
 * externo no cambie. Antes la admisión recuperaba «la última» evaluación con otra lectura, fuera de
 * la transacción, y esa lectura no veía la fila recién insertada (AT-006).
 */
export type RecordedEligibility = EligibilityResponse & { evaluationId: string };

export function toEligibilityResponse(recorded: RecordedEligibility): EligibilityResponse {
  const { evaluationId: _omitted, ...response } = recorded;
  void _omitted;
  return response;
}

/**
 * Motor de habilitación crediticia.
 *
 * Responde una sola pregunta —"¿este cliente puede solicitar un crédito y, si no, por qué?"— y deja
 * evidencia de cada respuesta en `customer_eligibility_evaluations`. La habilitación NO es una
 * bandera que alguien pueda escribir: es el resultado de evaluar condiciones verificables, con la
 * versión de la regla registrada para que una decisión pasada siga siendo explicable aunque la
 * regla cambie después.
 *
 * Es también la única fuente del avance del onboarding que consume el frontend, de modo que la
 * pantalla de progreso y la puerta de entrada al crédito no puedan discrepar nunca.
 */
@Injectable()
export class CustomerEligibilityService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
    private readonly lifecycleRepository: CustomerLifecycleRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /** Lectura para el cliente y para roles internos. Persiste la evaluación como evidencia. */
  async getEligibility(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }): Promise<EligibilityResponse> {
    assertOwnCustomerResource(input.currentUser, input.customerId);
    const recorded = await this.evaluateAndRecord({
      tenantId: input.tenantId,
      customerId: input.customerId,
      evaluatedByType: input.currentUser.role,
      evaluatedByInternalUserId: input.currentUser.internalUserId ?? null,
      decisionSource: 'automatic',
    });
    return toEligibilityResponse(recorded);
  }

  /**
   * Bloquea la fila del cliente (`FOR UPDATE`) dentro de la transacción de quien va a decidir sobre
   * él. Es el mismo bloqueo que toman las transiciones de ciclo de vida, así que una decisión
   * (admitir un crédito) y un cambio de estado concurrentes se ordenan en vez de cruzarse (AT-007).
   * Vive aquí, y no en un repositorio exportado, para que Crédito no dependa de la persistencia de
   * Clientes.
   */
  async lockCustomerForDecision(tenantId: string, customerId: string, transaction: Transaction): Promise<void> {
    const customer = await this.lifecycleRepository.findForUpdate(tenantId, customerId, { transaction });
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
  }

  /** Evalúa sin persistir. Útil para composiciones que ya están dentro de otra transacción. */
  async evaluate(tenantId: string, customerId: string, transaction?: Transaction): Promise<EligibilityAssessment> {
    const customer = await this.customersRepository.findById(tenantId, customerId, { transaction });
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    const facts = await this.eligibilityRepository.loadFacts(tenantId, customerId, { transaction });
    return assess(facts, normalizeLifecycleStatus(customer.lifecycleStatus), new Date());
  }

  /**
   * Evalúa, persiste la evidencia y, si corresponde, promueve al cliente a `active`.
   *
   * La promoción automática solo ocurre desde `under_review`: un cliente que todavía está cargando
   * datos no salta a habilitado porque en ese instante no le falte nada, y uno bloqueado o
   * rechazado nunca se rehabilita solo. La transición se hace con `advance`, que descarta —sin
   * romper— las transiciones que la máquina de estados no permite.
   */
  async evaluateAndRecord(input: {
    tenantId: string;
    customerId: string;
    evaluatedByType: string;
    evaluatedByInternalUserId: string | null;
    decisionSource: 'automatic' | 'manual_override' | 'manual_decision';
    reasonCode?: string | null;
    notes?: string | null;
    transaction?: Transaction;
    /**
     * Hechos ya leídos por quien llama, dentro de la MISMA transacción. La admisión de crédito los
     * lee una vez y los reutiliza para la elegibilidad general y la del producto (AT-007): dos
     * lecturas separadas podían ver dos estados distintos del mismo cliente.
     */
    facts?: EligibilityFacts;
  }): Promise<RecordedEligibility> {
    const run = async (transaction: Transaction): Promise<RecordedEligibility> => {
      const customer = await this.customersRepository.findById(input.tenantId, input.customerId, { transaction });
      if (!customer) throw new NotFoundException('Cliente no encontrado.');

      // CON la transacción: este método se encadena tras la verificación de identidad y tras el
      // envío a revisión, y leerlo por fuera evaluaba el estado ANTERIOR a esas escrituras.
      const facts = input.facts ?? (await this.eligibilityRepository.loadFacts(input.tenantId, input.customerId, { transaction }));
      const now = new Date();
      let status = normalizeLifecycleStatus(customer.lifecycleStatus);
      let assessment = assess(facts, status, now);

      // Promoción automática: si lo único que faltaba era el estado y todo lo demás cumple.
      if (!assessment.eligible && status === 'under_review' && onlyBlockedByAccountStatus(assessment)) {
        const transitioned = await this.lifecycleService.advance({
          tenantId: input.tenantId,
          customerId: input.customerId,
          toStatus: 'active',
          reasonCode: 'eligibility_conditions_met',
          changedByType: input.evaluatedByType,
          changedByInternalUserId: input.evaluatedByInternalUserId,
          notes: 'Habilitación automática: todas las condiciones de la regla se cumplen.',
          transaction,
        });
        if (transitioned?.changed) {
          status = 'active';
          assessment = assess(facts, status, now);
        }
      }

      const evaluationId = await this.persist({ input, customer: customer, facts, assessment, status, now, transaction });
      return { ...assessment, evaluatedAt: now.toISOString(), evaluationId };
    };

    return input.transaction ? run(input.transaction) : this.sequelize.transaction(run);
  }

  private async persist(context: {
    input: {
      tenantId: string;
      customerId: string;
      evaluatedByType: string;
      evaluatedByInternalUserId: string | null;
      decisionSource: string;
      reasonCode?: string | null;
      notes?: string | null;
    };
    customer: Awaited<ReturnType<CustomersRepository['findById']>>;
    facts: EligibilityFacts;
    assessment: EligibilityAssessment;
    status: CustomerLifecycleStatus;
    now: Date;
    transaction: Transaction;
  }): Promise<string> {
    const evaluation = await this.lifecycleRepository.createEvaluation(
      {
        tenantId: context.input.tenantId,
        customerId: context.input.customerId,
        eligible: context.assessment.eligible,
        lifecycleStatus: context.status,
        ruleVersion: context.assessment.ruleVersion,
        blockers: context.assessment.blockers,
        factsHash: factsIntegrityHash(context.facts, context.status),
        evaluatedByType: context.input.evaluatedByType,
        evaluatedByInternalUserId: context.input.evaluatedByInternalUserId,
        decisionSource: context.input.decisionSource,
        reasonCode: context.input.reasonCode ?? null,
        notes: context.input.notes ?? null,
        evaluatedAt: context.now,
      },
      { transaction: context.transaction },
    );

    if (context.customer) {
      await this.lifecycleRepository.applyEligibilityCache(
        context.customer,
        { eligible: context.assessment.eligible, now: context.now },
        { transaction: context.transaction },
      );
    }
    return String(evaluation.id);
  }

  /** Última evaluación registrada, sin recalcular. Para vistas internas y auditoría. */
  async getLatestEvaluation(tenantId: string, customerId: string) {
    return this.lifecycleRepository.findLatestEvaluation(tenantId, customerId);
  }
}

function onlyBlockedByAccountStatus(assessment: EligibilityAssessment): boolean {
  return assessment.blockers.length === 1 && assessment.blockers[0].code === 'ACCOUNT_NOT_ACTIVE';
}

/**
 * Huella de los insumos de la evaluación.
 *
 * No guarda los datos en sí (serían PII duplicada en una tabla de auditoría), sino un hash de los
 * hechos derivados. Permite demostrar que dos evaluaciones partieron exactamente del mismo estado
 * de información, o detectar que cambió algo entre una y otra.
 */
function factsIntegrityHash(facts: EligibilityFacts, status: CustomerLifecycleStatus): string {
  return sha256Hex(
    JSON.stringify({
      status,
      hasCredentials: facts.hasCredentials,
      verifiedContactCount: facts.verifiedContactCount,
      profileVersionId: facts.profile ? String(facts.profile.id) : null,
      financial: [...facts.presentFinancialAttributeCodes].sort(),
      hasCurrentAddress: facts.hasCurrentAddress,
      referenceContactCount: facts.referenceContactCount,
      identityDocumentId: facts.identityDocument ? String(facts.identityDocument.id) : null,
      identityVerificationResult: facts.identityVerificationResult,
      pendingEvidenceReviewCount: facts.pendingEvidenceReviewCount,
      consents: [...facts.grantedConsentDocumentIds].sort(),
      requiredConsents: [...facts.requiredConsentDocumentIds].sort(),
      openObservationCount: facts.openObservationCount,
      unclearedWatchlistMatchCount: facts.unclearedWatchlistMatchCount,
      riskResultId: facts.latestRisk ? String(facts.latestRisk.id) : null,
      openFraudCaseCount: facts.openFraudCaseCount,
    }),
  );
}
