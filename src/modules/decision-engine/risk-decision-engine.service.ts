/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza traslada la evaluación de riesgo de onboarding a una política versionada y auditable.
 * @system ejecuta el artefacto de riesgo en el motor y traduce su desenlace al vocabulario del onboarding.
 */
import { DecisionArtifactBindingService } from './decision-artifact-binding.service.js';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import type { DecisionResponse } from './decision-engine.types.js';
import { SubjectReferenceService } from './subject-reference.service.js';

/** Desenlaces del artefacto de riesgo que dejan seguir el onboarding sin intervención. */
const CONTINUE_OUTCOMES = new Set(['APPROVE', 'APPROVED', 'CONTINUE', 'PASS', 'ACCEPT', 'ACCEPTED']);

const COMPLETED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED']);

/**
 * Desenlaces con los que el artefacto dice «no». En el onboarding NO rechazan (D-P3, decisión de
 * Pablo del 2026-09-25): el alta pasa a revisión humana y el artefacto v1 se queda como se firmó.
 * Lo que se corrige es que el core deje ESCRITO que el Motor dijo «no», en vez de perderlo dentro
 * de un `manual_review_required` indistinguible del de un «no sé».
 */
const DECLINE_OUTCOMES = new Set(['DECLINE', 'DECLINED', 'REJECT', 'REJECTED', 'DENY', 'DENIED']);

/**
 * El Motor RESPONDIÓ pero declinó pronunciarse: no es lo mismo que no haber podido preguntarle.
 *
 * Hasta el 2026-09-25 este estado caía en la misma rama que un fallo técnico (`return null`), y
 * quien resolvía la cadena (`RiskPolicyDecisionService`) lo registraba como `heuristic_v0` con el
 * motivo `decision_engine_unavailable` — una mentira sobre la procedencia: el Motor SÍ respondió,
 * sólo que sin veredicto. `decisionSource='engine_no_decision'` (C-4/C-5) deja escrita la verdad sin
 * tocar el desenlace de negocio (D-P3: sigue yendo a revisión, nunca se rechaza).
 */
const NO_DECISION_STATUS = 'NO_DECISION';

export type RiskEngineDecision = {
  decision: string;
  reasons: string[];
  artifactVersionId: string | null;
  executionId: string;
  /**
   * El caso de revisión manual que el motor abrió, si abrió alguno.
   *
   * Es lo que permite a Atlas apartarse: con caso en el motor, la bandeja buena es la suya y este
   * lado no debe ofrecer un segundo formulario. Sin caso —un rechazo, por ejemplo— la cola de
   * Atlas es la única que hay y tiene que seguir funcionando.
   */
  manualReviewCaseCode: string | null;
  /** `true` cuando el status fue literalmente `NO_DECISION`: el Motor respondió sin veredicto. */
  noDecision: boolean;
  /**
   * El desenlace REAL que contestó el Motor, tal cual (`DECLINE`, `APPROVE`, `MANUAL_REVIEW`…), o
   * `null` si no hubo (`NO_DECISION`). `decision` es el vocabulario del onboarding —«sigue» o
   * «revisión»— y aplana un rechazo del Motor a revisión (D-P3); esto conserva lo que de verdad dijo.
   */
  engineOutcome: string | null;
};

/**
 * Traduce la respuesta del Motor al vocabulario del onboarding, o `null` si no terminó.
 *
 * Fuera de `evaluate` porque allí conviven la resolución del artefacto, el sujeto y la llamada; esto
 * es la política de lectura de UN desenlace, y se puede leer sin atravesar el transporte.
 */
function interpretResponse(response: DecisionResponse): RiskEngineDecision | null {
  const status = response.status.toUpperCase();
  const reasons = response.reasonCodes.map((reason) => reason.code);
  const executionId = response.executionId;
  const artifactVersionId = response.artifact?.versionId ?? null;
  const manualReviewCaseCode = response.manualReview?.caseCode ?? null;

  // `NO_DECISION` es una respuesta COMPLETA del Motor, no una avería: se distingue de las demás
  // no-completadas (PENDING, RUNNING…) para que quien resuelva la cadena no lo confunda con «no se
  // pudo preguntar».
  if (status === NO_DECISION_STATUS) {
    return {
      decision: 'manual_review_required',
      reasons: reasons.length > 0 ? reasons : ['engine_no_decision'],
      artifactVersionId,
      executionId,
      manualReviewCaseCode,
      noDecision: true,
      engineOutcome: null,
    };
  }

  if (!COMPLETED_STATUSES.has(status)) return null;

  const outcome = (response.outcome ?? '').toUpperCase();
  const outcomeReason = `engine_outcome_${outcome.toLowerCase() || 'unknown'}`;
  // Un «no» del Motor añade SIEMPRE su desenlace a los motivos (D-P3): aunque el artefacto haya
  // publicado sus propios códigos, la fila de evidencia tiene que decir que el Motor rechazó y no
  // sólo por qué. Sin motivos propios, el desenlace es el único motivo (como siempre).
  const withOutcome = DECLINE_OUTCOMES.has(outcome) && !reasons.includes(outcomeReason) ? [...reasons, outcomeReason] : reasons;
  return {
    // Cualquier desenlace que no sea un «sigue adelante» explícito manda el caso a una persona.
    decision: CONTINUE_OUTCOMES.has(outcome) ? 'approved_for_next_step' : 'manual_review_required',
    reasons: withOutcome.length > 0 ? withOutcome : [outcomeReason],
    artifactVersionId,
    executionId,
    manualReviewCaseCode,
    noDecision: false,
    engineOutcome: outcome || null,
  };
}

@Injectable()
export class RiskDecisionEngineService {
  private readonly logger = new Logger(RiskDecisionEngineService.name);

  constructor(
    private readonly client: DecisionEngineClient,
    private readonly artifactBindings: DecisionArtifactBindingService,
    private readonly subjects: SubjectReferenceService,
  ) {
    /*
     * Se avisa al arrancar, no en la primera alta. Medido en la base desplegada el 2026-09-14: cero
     * evaluaciones de riesgo decididas por el Motor, todas por la heurística local, porque esta
     * variable estaba vacía en todos los entornos y nada lo decía. El aviso no impide arrancar —la
     * asignación por inquilino desde el portal también vale— pero deja el hueco a la vista.
     */
    if (this.client.isConfigured && !env.DECISION_ENGINE_RISK_ARTIFACT) {
      this.logger.warn(
        'DECISION_ENGINE_RISK_ARTIFACT está vacío: el riesgo de onboarding sólo llegará al Motor si hay una ' +
          'asignación `risk` por inquilino en /internal/settings/decision-artifacts; si no, cada alta va a revisión humana.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.client.isConfigured;
  }

  /**
   * Evalúa el riesgo de onboarding contra la política versionada del motor.
   *
   * Devuelve `null` —y no lanza— cuando el motor no está configurado o no responde. Aquí, a
   * diferencia de la decisión de crédito, degradar es lo correcto: esto no concede dinero, y
   * bloquear el alta de clientes por una avería del motor sería un daño mayor que seguir con la
   * política local. Lo que no se puede perder es la PROCEDENCIA, y por eso quien llama registra de
   * qué escalón salió la decisión: mezclar en la misma medida los casos resueltos por el motor y
   * los resueltos por el heurístico de arranque daría una población que parece una y son dos.
   */
  async evaluate(input: {
    tenantId: string;
    customerId: string;
    assessmentType: string;
    features: Record<string, number | boolean>;
    idempotencyKey: string;
    subjectReference?: string;
  }): Promise<RiskEngineDecision | null> {
    if (!this.client.isConfigured) return null;

    try {
      /*
       * La asignación del portal se consulta ANTES de mirar el entorno. Antes el `if` de arriba
       * exigía la variable de entorno para siquiera llegar aquí, así que la pantalla
       * `/internal/settings/decision-artifacts` dejaba elegir un artefacto de riesgo que este código
       * nunca leía.
       */
      const binding = await this.artifactBindings.resolve(String(input.tenantId), 'risk');
      const artifactCode = binding.artifactCode ?? env.DECISION_ENGINE_RISK_ARTIFACT;
      if (!artifactCode) return null;
      const response = await this.client.execute(artifactCode, {
        requestId: `risk-${input.assessmentType}-${input.idempotencyKey}`.slice(0, 120),
        idempotencyKey: input.idempotencyKey,
        correlationId: randomUUID(),
        subjectReference: input.subjectReference ?? (await this.subjectReferenceFor(input.tenantId, input.customerId)),
        variables: { ...input.features, assessment_type: input.assessmentType },
        context: { source: 'atlas-backend', module: 'risk-onboarding' },
      });

      return interpretResponse(response);
    } catch (error) {
      this.logger.warn(`El motor no pudo evaluar el riesgo de onboarding; se usa la política local: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * La referencia opaca del sujeto, la MISMA que ve el Motor en las decisiones de crédito (C-4).
   *
   * Sin ella el riesgo de onboarding y el crédito del mismo cliente eran dos sujetos anónimos
   * distintos para el Motor: sus ejecuciones no se podían unir para medir, por ejemplo, si el riesgo
   * del alta predecía el crédito. Se usa el propósito por defecto —el de crédito— porque ese es el
   * que permite la unión; separarlos por propósito la impediría.
   *
   * Es de mejor esfuerzo: sin la sal, o si falla la escritura del vínculo, la evaluación sigue SIN
   * referencia (el Motor lo registra como sujeto ausente) y queda un aviso. Perder la unión sólo
   * cuesta análisis; degradar la decisión —o dejar sin alta al cliente— por eso le costaría a él.
   */
  private async subjectReferenceFor(tenantId: string, customerId: string): Promise<string | undefined> {
    try {
      return await this.subjects.register({ tenantId, customerId });
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el sujeto del cliente ${customerId} para el riesgo de onboarding: ${(error as Error).message}`,
      );
      return undefined;
    }
  }
}
