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

/** Desenlaces del artefacto de riesgo que dejan seguir el onboarding sin intervención. */
const CONTINUE_OUTCOMES = new Set(['APPROVE', 'APPROVED', 'CONTINUE', 'PASS', 'ACCEPT', 'ACCEPTED']);

const COMPLETED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED']);

export type RiskEngineDecision = {
  decision: string;
  reasons: string[];
  artifactVersionId: string | null;
  executionId: string;
};

@Injectable()
export class RiskDecisionEngineService {
  private readonly logger = new Logger(RiskDecisionEngineService.name);

  constructor(private readonly client: DecisionEngineClient,
    private readonly artifactBindings: DecisionArtifactBindingService,
  ) {}

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
    if (!this.client.isConfigured || !env.DECISION_ENGINE_RISK_ARTIFACT) return null;

    try {
      const binding = await this.artifactBindings.resolve(String(input.tenantId), 'risk');
      const response = await this.client.execute(binding.artifactCode ?? env.DECISION_ENGINE_RISK_ARTIFACT, {
        requestId: `risk-${input.assessmentType}-${input.idempotencyKey}`.slice(0, 120),
        idempotencyKey: input.idempotencyKey,
        correlationId: randomUUID(),
        subjectReference: input.subjectReference,
        variables: { ...input.features, assessment_type: input.assessmentType },
        context: { source: 'atlas-backend', module: 'risk-onboarding' },
      });

      if (!COMPLETED_STATUSES.has(response.status.toUpperCase())) return null;

      const outcome = (response.outcome ?? '').toUpperCase();
      const reasons = response.reasonCodes.map((reason) => reason.code);
      return {
        // Cualquier desenlace que no sea un «sigue adelante» explícito manda el caso a una persona.
        decision: CONTINUE_OUTCOMES.has(outcome) ? 'approved_for_next_step' : 'manual_review_required',
        reasons: reasons.length > 0 ? reasons : [`engine_outcome_${outcome.toLowerCase() || 'unknown'}`],
        artifactVersionId: response.artifact?.versionId ?? null,
        executionId: response.executionId,
      };
    } catch (error) {
      this.logger.warn(`El motor no pudo evaluar el riesgo de onboarding; se usa la política local: ${(error as Error).message}`);
      return null;
    }
  }
}
