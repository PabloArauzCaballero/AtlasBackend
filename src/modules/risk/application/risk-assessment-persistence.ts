/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
 * @system escribe la corrida, su evidencia y el caso de revisión dentro de la transacción que se le pasa.
 */
import { Transaction } from 'sequelize';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { RiskRepository } from '../risk.repository.js';
import { writeFeatureEvidence } from './risk-feature-evidence.js';

/** Identidad de lo que se está evaluando. Viaja completa porque cada tabla escribe un trozo distinto. */
export type AssessmentSubject = {
  tenantId: string;
  customerId: string;
  sessionId: string | null;
  deviceId: string | null;
  assessmentType: string;
  channel: string;
  idempotencyKey: string;
};

type FeatureMap = Record<string, number | boolean>;

/**
 * Abre la corrida: snapshot de features, fila de la corrida y su contexto.
 *
 * Los tres van juntos y en este orden porque el snapshot es la evidencia de CON QUÉ datos se
 * evaluó, y una corrida que apunta a un snapshot inexistente —o un snapshot sin corrida— deja una
 * decisión que no se puede reconstruir. El `attach` posterior cierra la referencia circular que
 * ninguna de las dos filas puede establecer sola.
 *
 * Recibe un objeto y no seis argumentos sueltos: la lista crecería con cada dimensión nueva del
 * modelo, y una llamada de seis posiciones es donde dos parámetros del mismo tipo se intercambian
 * sin que el compilador diga nada.
 */
export async function openAssessmentRun(input: {
  repository: RiskRepository;
  subject: AssessmentSubject;
  featureMap: FeatureMap;
  missing: string[];
  requestedLimitContext: unknown;
  now: Date;
  transaction: Transaction;
}) {
  const { repository, subject, now, transaction } = input;
  const snapshot = await writeFeatureEvidence(repository, subject, input.featureMap, input.missing, now, transaction);

  const run = await repository.createRiskAssessmentRun(
    {
      tenantId: subject.tenantId,
      customerId: subject.customerId,
      sessionId: subject.sessionId,
      deviceId: subject.deviceId,
      featureSnapshotId: String(snapshot.id),
      assessmentType: subject.assessmentType,
      triggerSource: subject.channel,
      idempotencyKey: subject.idempotencyKey,
      now,
    },
    { transaction },
  );

  await repository.attachSnapshotToRun(snapshot, String(run.id), { transaction });
  await repository.createRiskAssessmentContext(
    {
      tenantId: subject.tenantId,
      riskAssessmentRunId: String(run.id),
      contextPayloadHash: sha256Hex(JSON.stringify(input.requestedLimitContext ?? {})),
      now,
    },
    { transaction },
  );

  return { run, snapshot };
}

/**
 * Escribe por qué se decidió así: una fila por regla disparada y la contribución de las features.
 *
 * Es lo que convierte una recomendación en una explicable. Sin estas filas el resultado dice qué se
 * decidió y no queda nada que responda por qué — que es exactamente lo que pide un cliente al
 * reclamar y un regulador al revisar.
 */
export async function recordDecisionEvidence(input: {
  repository: RiskRepository;
  tenantId: string;
  runId: string;
  reasons: readonly string[];
  decision: string;
  featureMap: FeatureMap;
  rulesetVersionCode: string;
  readiness: { hasIdentity: boolean; verifiedContactCount: number; scorePoints: string };
  now: Date;
  transaction: Transaction;
}) {
  const { repository, tenantId, runId, decision, now, transaction } = input;

  for (const reason of input.reasons) {
    await repository.createRuleFired(
      {
        tenantId,
        riskAssessmentRunId: runId,
        ruleCode: reason,
        riskDimension: reason.includes('identity') ? 'identity' : 'onboarding',
        outputAction: decision,
        reasonCode: reason,
        severity: decision === 'manual_review_required' ? 'medium' : 'low',
        isHardStop: false,
        inputValues: input.featureMap,
        rulesetVersionCode: input.rulesetVersionCode,
        now,
      },
      { transaction },
    );
  }

  await repository.createContribution(
    {
      tenantId,
      riskAssessmentRunId: runId,
      featureCode: 'identity_and_contact_readiness',
      rawValue: { hasIdentity: input.readiness.hasIdentity, verifiedContactCount: input.readiness.verifiedContactCount },
      scorePoints: input.readiness.scorePoints,
      reasonCode:
        input.readiness.hasIdentity && input.readiness.verifiedContactCount > 0 ? 'positive_readiness' : 'missing_onboarding_data',
      now,
    },
    { transaction },
  );
}

/**
 * Abre el caso de revisión manual cuando la decisión no aprueba, con una incidencia por dato faltante.
 *
 * Devuelve `null` si la decisión aprueba. La alternativa —abrir siempre el caso y cerrarlo si sobra—
 * llenaría la bandeja de revisión de casos que nadie tiene que mirar, y el ruido acaba haciendo que
 * tampoco se miren los que sí importan.
 */
export async function openManualReviewCase(input: {
  repository: RiskRepository;
  tenantId: string;
  customerId: string;
  runId: string;
  decision: string;
  riskLevel: string;
  reasons: readonly string[];
  missing: readonly string[];
  now: Date;
  transaction: Transaction;
}): Promise<string | null> {
  if (input.decision === 'approved_for_next_step') return null;

  const { repository, tenantId, customerId, runId, now, transaction } = input;
  const manualCase = await repository.createManualReviewCase(
    {
      tenantId,
      customerId,
      riskAssessmentRunId: runId,
      priority: input.riskLevel === 'high' ? 'high' : 'medium',
      caseType: 'risk_assessment_review',
      notes: `Revisión requerida: ${input.reasons.join(', ')}`,
      now,
    },
    { transaction },
  );

  for (const missingCode of input.missing) {
    await repository.createDataQualityIssue(
      { tenantId, targetRecordId: customerId, issueCode: `missing_${missingCode}`, now },
      { transaction },
    );
  }

  return String(manualCase.id);
}
