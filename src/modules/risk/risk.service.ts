/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
 * @system calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.
 */
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { CLOCK, systemClock, type Clock } from '../../platform/di/clock.js';
import { RISK_INPUT_FACTS_PORT, type RiskInputFactsPort } from './application/ports/risk-input-facts.port.js';
import { LocalRiskInputFactsAdapter } from './infrastructure/local-risk-input-facts.adapter.js';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
// `RISK_RULESET_VERSION` ya no se importa aquí: la versión del ruleset la resuelve
// `RiskPolicyDecisionService`, que es quien decide si la evaluación vino del ruleset persistido o
// del fallback heurístico. Dejarlo importado hacía creer que este servicio todavía la usaba.
import {
  openAssessmentRun,
  openManualReviewCase,
  recordDecisionEvidence,
  type AssessmentSubject,
} from './application/risk-assessment-persistence.js';
import { resolveModelIdentity } from './application/risk-model-identity.js';
import { buildRiskExplanation } from './application/risk-explanation.js';
import { RiskPolicyDecisionService } from './application/risk-policy-decision.service.js';
import { toPolicyFeatures } from './application/risk-policy-features.js';
import { buildHeuristicFallback, computeHeuristicScores, toPersistedFeatureMap } from './application/risk-heuristic-scoring.js';
import { RiskAssessmentResultResponseDto } from './risk.dtos.js';
import { toRiskAssessmentResultResponse } from './risk.mapper.js';
import { RiskRepository } from './risk.repository.js';
import { RevisionManualRepository } from './repositories/revision-manual.repository.js';
import { CreateRiskAssessmentDto } from './risk.schemas.js';

function toScore(value: number): string {
  return Math.max(0, Math.min(100, value)).toFixed(2);
}

/**
 * A quién y en qué contexto se está evaluando.
 *
 * Se arma una sola vez y viaja completo a cada escritura: la corrida, el snapshot y el resultado
 * comparten esta identidad, y construirla por separado en cada sitio es como una fila acaba
 * apuntando a una sesión y su vecina a ninguna.
 */
function toAssessmentSubject(input: {
  tenantId: string;
  customerId: string;
  body: CreateRiskAssessmentDto;
  idempotencyKey: string;
}): AssessmentSubject {
  return {
    tenantId: input.tenantId,
    customerId: input.customerId,
    sessionId: input.body.sessionId ?? null,
    deviceId: input.body.deviceId ?? null,
    assessmentType: input.body.assessmentType,
    channel: input.body.channel,
    idempotencyKey: input.idempotencyKey,
  };
}

/**
 * Lo que el consumidor necesita para actuar: qué sigue y por qué, en su idioma y no en el del modelo.
 *
 * `fraudRiskLevel` se deriva del puntaje en vez de publicarlo: el número exacto es precisamente lo
 * que no se le enseña a quien está siendo evaluado, porque conocerlo permite ajustar el siguiente
 * intento hasta quedar justo por encima del umbral.
 */
function decisionOutcomeFields(decision: string, fraudScore: number, reasons: readonly string[]) {
  return {
    fraudRiskLevel: fraudScore >= 70 ? 'high' : fraudScore >= 40 ? 'medium' : 'low',
    nextStep: decision === 'manual_review_required' ? 'manual_review' : 'continue_onboarding',
    reasons: reasons.map((code) => ({ code, message: code.replaceAll('_', ' ') })),
  };
}

/**
 * Las siete columnas de puntaje de la fila de resultado.
 *
 * Se construyen juntas porque se escriben juntas: una fila con el total actualizado y una dimensión
 * del cálculo anterior no falla al insertarse, simplemente deja de sumar — y el desglose que un
 * analista abre para entender la decisión deja de corresponder con el puntaje que la produjo.
 */
function dimensionScoreColumns(scores: ReturnType<typeof computeHeuristicScores>) {
  return {
    scoreTotal: toScore(scores.totalScore),
    fraudScore: toScore(scores.fraudScore),
    identityScore: toScore(scores.identityScore),
    deviceRiskScore: toScore(scores.deviceScore),
    behaviorScore: toScore(scores.behaviorScore),
    contactabilityScore: toScore(scores.contactScore),
    consistencyScore: toScore(scores.consistencyScore),
  };
}

@Injectable()
export class RiskService {
  constructor(
    private readonly riskRepository: RiskRepository,
    // El caso de revisión y la incidencia de dato faltante viven en su propio puerto: no leen nada
    // del modelo de riesgo, sólo abren el trabajo humano que la evaluación dejó pendiente.
    private readonly revisionManualRepository: RevisionManualRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly policyDecisionService: RiskPolicyDecisionService,
    @InjectConnection() private readonly sequelize: Sequelize,
    @Optional() @Inject(CLOCK) private readonly clock: Clock = systemClock,
    @Optional() @Inject(RISK_INPUT_FACTS_PORT) inputFacts?: RiskInputFactsPort,
  ) {
    // Construcción a mano (pruebas, scripts): el adaptador local sobre los mismos repositorios.
    this.inputFacts = inputFacts ?? new LocalRiskInputFactsAdapter(this.customersRepository, this.riskRepository);
  }

  private readonly inputFacts: RiskInputFactsPort;

  async getLatestCustomerRiskResult(input: {
    tenantId: string;
    customerId: string;
    currentUser: AuthenticatedUser;
  }): Promise<RiskAssessmentResultResponseDto | null> {
    assertOwnCustomerResource(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const result = await this.riskRepository.findLatestCustomerRiskResult(input.tenantId, input.customerId);
    return result ? toRiskAssessmentResultResponse(result) : null;
  }

  /**
   * Comprueba que el cliente pueda evaluarse y reúne las señales con las que se le va a evaluar.
   *
   * Las dos puertas van aquí y no en el cálculo porque son de ADMISIÓN: un cliente bloqueado o sin
   * consentimiento vigente no produce un puntaje bajo, no produce puntaje ninguno. Evaluarlo igual y
   * descartar el resultado después dejaría escritas features de alguien que no autorizó su
   * tratamiento, que es precisamente lo que el consentimiento existe para impedir.
   */
  private async gatherRiskSignals(input: { tenantId: string; customerId: string; body: CreateRiskAssessmentDto }) {
    // AT-027: los hechos llegan por puerto (misma lógica de lectura, ahora detrás de un contrato).
    const facts = await this.inputFacts.loadFacts(input.tenantId, input.customerId);
    if (!facts.exists) throw new NotFoundException('Cliente no encontrado.');
    if (facts.lifecycleStatus === 'blocked') {
      throw new UnprocessableEntityException('CUSTOMER_BLOCKED_FOR_RISK_ASSESSMENT');
    }

    const { hasGrantedConsent, verifiedContactCount, hasIdentity } = facts;
    if (!hasGrantedConsent) throw new UnprocessableEntityException('REQUIRED_CONSENT_MISSING');

    // Los puntajes por dimensión siguen siendo heurísticos: alimentan el desglose explicativo y el
    // nivel de riesgo, NO la decisión. La decisión la toma el ruleset versionado en base de datos
    // cuando hay uno activo — cambiar un umbral pasó a ser configuración auditada, no un despliegue.
    const scores = computeHeuristicScores({ hasIdentity, verifiedContactCount, hasDevice: Boolean(input.body.deviceId) });

    return { hasGrantedConsent, hasIdentity, verifiedContactCount, scores };
  }

  async createRiskAssessment(input: {
    tenantId: string;
    customerId: string;
    body: CreateRiskAssessmentDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);

    const now = this.clock.now();
    const { hasGrantedConsent, hasIdentity, verifiedContactCount, scores } = await this.gatherRiskSignals(input);
    const { identityScore, contactScore, fraudScore, totalScore, riskLevel, missing } = scores;

    const policy = await this.policyDecisionService.resolve({
      tenantId: input.tenantId,
      customerId: input.customerId,
      assessmentType: input.body.assessmentType,
      now,
      idempotencyKey: input.idempotencyKey,
      // Se difunden los puntajes en vez de enumerarlos: `toPolicyFeatures` ya declara qué campos
      // consume, y repetir la lista aquí garantizaba que al añadir una dimensión al modelo se
      // olvidara en este punto — el sitio donde su ausencia es más difícil de notar.
      features: toPolicyFeatures({ hasIdentity, verifiedContactCount, hasGrantedConsent, ...scores }),
      fallback: buildHeuristicFallback(scores),
    });
    const decision = policy.decision;
    const reasons = policy.reasons;
    const modelIdentity = resolveModelIdentity(policy);

    return this.sequelize.transaction(async (transaction) => {
      const featureMap = toPersistedFeatureMap(scores, { hasGrantedConsent, verifiedContactCount, hasIdentity });
      const subject = toAssessmentSubject(input);
      const { run, snapshot } = await openAssessmentRun({
        repository: this.riskRepository,
        subject,
        featureMap,
        missing,
        requestedLimitContext: input.body.requestedLimitContext,
        decisionSource: policy.decisionSource,
        decisionExecutionId: policy.decisionExecutionId,
        now,
        transaction,
      });

      await recordDecisionEvidence({
        repository: this.riskRepository,
        tenantId: input.tenantId,
        runId: String(run.id),
        reasons,
        decision,
        featureMap,
        rulesetVersionCode: policy.rulesetVersionCode,
        readiness: { hasIdentity, verifiedContactCount, scorePoints: toScore((identityScore + contactScore) / 2) },
        now,
        transaction,
      });

      const result = await this.riskRepository.createRiskResult(
        {
          ...subject,
          runId: String(run.id),
          recommendedAction: decision,
          riskLevel,
          ...dimensionScoreColumns(scores),
          reasonCodes: { reasons },
          featureSnapshotId: String(snapshot.id),
          integrityHash: sha256Hex(`${run.id}:${decision}:${totalScore}`),
          // La fila persistida guarda la versión del modelo que decidió, no una constante: es la
          // copia que se consultará dentro de meses, cuando ya nadie recuerde qué escalón resolvió.
          modelVersionCode: modelIdentity.modelVersion,
          rulesetVersionCode: policy.rulesetVersionCode,
          now,
        },
        { transaction },
      );

      const manualReviewCaseId = await openManualReviewCase({
        repository: this.revisionManualRepository,
        tenantId: input.tenantId,
        customerId: input.customerId,
        runId: String(run.id),
        decision,
        riskLevel,
        reasons,
        missing,
        // Sólo se delega si el Motor abrió de verdad su caso; el porqué, en `openManualReviewCase`.
        decisionExecutionId: policy.motorAbrioCaso ? policy.decisionExecutionId : null,
        now,
        transaction,
      });

      await this.riskRepository.createAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'risk_assessment.created',
          targetId: input.customerId,
          payload: { runId: String(run.id), resultId: String(result.id), decision, manualReviewCaseId },
          now,
        },
        { transaction },
      );

      return {
        riskAssessmentRunId: String(run.id),
        riskAssessmentResultId: String(result.id),
        decision,
        riskLevel,
        manualReviewCaseId,
        ...decisionOutcomeFields(decision, fraudScore, reasons),
        // El modelo que se publica es el que DE VERDAD decidió (`risk-model-identity.ts`).
        ...modelIdentity,
        decisionSource: policy.decisionSource,
        decisionExecutionId: policy.decisionExecutionId,
        rulesetVersion: policy.rulesetVersionCode,
      };
    });
  }

  async getRiskAssessmentDetail(tenantId: string, runId: string) {
    const [run, result, rules, contributions, snapshot] = await Promise.all([
      this.riskRepository.findRiskRun(tenantId, runId),
      this.riskRepository.findRiskResultByRun(tenantId, runId),
      this.riskRepository.findRulesByRun(tenantId, runId),
      this.riskRepository.findContributionsByRun(tenantId, runId),
      this.riskRepository.findSnapshotByRun(tenantId, runId),
    ]);
    if (!run) throw new NotFoundException('Evaluación de riesgo no encontrada.');
    return {
      run,
      result,
      rulesFired: rules,
      featureContributions: contributions,
      featureSnapshot: snapshot,
    };
  }

  async getRiskAssessmentExplanation(tenantId: string, runId: string) {
    const detail = await this.getRiskAssessmentDetail(tenantId, runId);
    if (!detail.result) throw new NotFoundException('Resultado de riesgo no encontrado.');
    // La forma la decide `risk-explanation.ts`, donde está escrito por qué la procedencia va antes.
    return buildRiskExplanation(detail, detail.result.recommendedAction);
  }
}
