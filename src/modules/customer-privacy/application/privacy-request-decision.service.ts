/**
 * @file Servicio de aplicación: el Motor opina sobre cada solicitud del titular, en sombra.
 * @business Antes de dejar que una máquina acepte o rechace un borrado, se mide cuánto coincide con lo que decide una persona.
 * @system recorre las solicitudes abiertas sin veredicto, ejecuta PRIVACIDAD_SOLICITUD_TITULAR y guarda lo que publicó, sin tocar el estado.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { FindOptions, Op } from 'sequelize';
import { DataSubjectRequestModel } from '../../../database/models/index.js';
import { DecisionArtifactBindingService } from '../../decision-engine/decision-artifact-binding.service.js';
import { DecisionEngineClient } from '../../decision-engine/decision-engine.client.js';
import type { DecisionResponse } from '../../decision-engine/decision-engine.types.js';
import { SubjectReferenceService } from '../../decision-engine/subject-reference.service.js';
import { esDecidiblePorElMotor, TIPO_DEL_MOTOR, variablesDeLaSolicitud } from './privacy-request-features.js';
import { PrivacyRequestFactsRepository } from './privacy-request-facts.repository.js';

/** Propósito de la referencia opaca: la de privacidad no es la de crédito, y quien resuelva una no obtiene la otra. */
export const PRIVACY_DECISION_PURPOSE = 'data_subject_rights';

export const PRIVACY_ENGINE_DECISIONS = ['ACEPTAR', 'RECHAZAR', 'REVISION_HUMANA'] as const;
export type PrivacyEngineDecision = (typeof PRIVACY_ENGINE_DECISIONS)[number];

/** Tras estos intentos fallidos se deja de preguntar: la persona decide igual y el error queda a la vista. */
export const MAX_ENGINE_ATTEMPTS = 5;

const COMPLETED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED']);

export type PrivacyEngineVerdict = {
  decision: PrivacyEngineDecision;
  reasonCode: string | null;
  action: string | null;
  riskSignals: number | null;
  reevaluateCredit: boolean | null;
  executionId: string;
  artifactVersionId: string | null;
};

export type ShadowSweepResult = {
  /** `unset`: no hay artefacto asignado para privacidad en este tenant, que es como se apaga. */
  skipped?: 'unset' | 'engine_not_configured';
  scanned: number;
  decided: number;
  failed: number;
};

@Injectable()
export class PrivacyRequestDecisionService {
  private readonly logger = new Logger(PrivacyRequestDecisionService.name);

  constructor(
    @InjectModel(DataSubjectRequestModel) private readonly requests: typeof DataSubjectRequestModel,
    private readonly facts: PrivacyRequestFactsRepository,
    private readonly client: DecisionEngineClient,
    private readonly artifactBindings: DecisionArtifactBindingService,
    private readonly subjects: SubjectReferenceService,
  ) {}

  /**
   * Una pasada del trabajo programado.
   *
   * **Sombra: no cambia el estado de nada.** La solicitud sigue en la cola de la persona, que la cierra con su motivo; lo
   * único nuevo es que el portal le enseña qué habría decidido el Motor. Por eso no se hace en la petición del cliente:
   * un Motor lento o caído no hace esperar a nadie, y la solicitud se vuelve a intentar en la pasada siguiente.
   *
   * El interruptor es la asignación del artefacto (Configuración → Motor de decisiones → Privacidad): sin ella esto no
   * lee ni una fila.
   */
  async sweepShadow(input: { tenantId: string; limit: number; now?: Date }): Promise<ShadowSweepResult> {
    if (!this.client.isConfigured) return { skipped: 'engine_not_configured', scanned: 0, decided: 0, failed: 0 };
    const binding = await this.artifactBindings.resolve(String(input.tenantId), 'privacy');
    if (!binding.artifactCode) return { skipped: 'unset', scanned: 0, decided: 0, failed: 0 };

    const pendientes = await this.requests.findAll({
      where: {
        tenantId: input.tenantId,
        status: { [Op.in]: ['received', 'in_progress'] },
        requestType: { [Op.in]: Object.keys(TIPO_DEL_MOTOR) },
        engineDecidedAt: null,
        engineAttempts: { [Op.lt]: MAX_ENGINE_ATTEMPTS },
        deleted: false,
      },
      order: [['requestedAt', 'ASC']],
      limit: input.limit,
    } as FindOptions);

    let decided = 0;
    let failed = 0;
    for (const solicitud of pendientes) {
      const ok = await this.decideOne(solicitud, binding.artifactCode, input.now ?? new Date());
      if (ok) decided += 1;
      else failed += 1;
    }
    return { scanned: pendientes.length, decided, failed };
  }

  /** Decide una solicitud y guarda el veredicto. Devuelve `false` si no hubo veredicto (el error queda en la fila). */
  async decideOne(solicitud: DataSubjectRequestModel, artifactCode: string, now: Date): Promise<boolean> {
    if (!esDecidiblePorElMotor(solicitud.requestType) || !solicitud.customerId) return false;
    try {
      const hechos = await this.facts.hechos({
        tenantId: solicitud.tenantId,
        customerId: solicitud.customerId,
        requestId: solicitud.id,
        requestType: String(solicitud.requestType),
        rectificationField: solicitud.rectificationField,
        now,
      });
      if (!hechos) throw new Error('el cliente de la solicitud no existe o está borrado');
      const variables = variablesDeLaSolicitud(solicitud, hechos);
      const subjectReference = await this.subjects.register({
        tenantId: solicitud.tenantId,
        customerId: solicitud.customerId,
        purposeCode: PRIVACY_DECISION_PURPOSE,
      });
      const fetchedAt = now.toISOString();
      const intentoId = `dsr-${solicitud.id}-${solicitud.engineAttempts + 1}`;
      const response = await this.client.execute(artifactCode, {
        requestId: intentoId,
        // Una clave POR INTENTO. El Motor mete `requestId` y `variables` en el hash de la petición y, con la misma clave y
        // otra carga, responde 409 `IDEMPOTENCY_PAYLOAD_MISMATCH` durante 24 h: con una clave fija por solicitud, un primer
        // intento que llegó al Motor y falló dejaba los cuatro siguientes quemados con 409 y la solicitud sin opinión para
        // siempre. Cada intento es una consulta nueva (en sombra no cambia nada), así que no hace falta repetir la anterior.
        idempotencyKey: intentoId,
        correlationId: randomUUID(),
        subjectReference,
        variables,
        // Todo se lee del libro en el momento de decidir: ninguna variable es un dato declarado hace meses.
        variableMetadata: Object.fromEntries(Object.keys(variables).map((codigo) => [codigo, { fetchedAt }])),
        context: { source: 'atlas-backend', module: 'customer-privacy', mode: 'shadow' },
      });
      if (!COMPLETED_STATUSES.has(response.status.toUpperCase())) {
        throw new Error(`el Motor respondió ${response.status} y no un veredicto`);
      }
      const veredicto = toPrivacyVerdict(response);
      await solicitud.update({
        decisionMode: 'shadow',
        engineDecision: veredicto.decision,
        engineReasonCode: veredicto.reasonCode,
        engineAction: veredicto.action,
        engineRiskSignals: veredicto.riskSignals,
        engineReevaluateCredit: veredicto.reevaluateCredit,
        engineInputsJson: variables,
        engineExecutionId: veredicto.executionId,
        engineArtifactCode: artifactCode,
        engineArtifactVersionId: veredicto.artifactVersionId,
        engineDecidedAt: now,
        engineAttempts: solicitud.engineAttempts + 1,
        engineLastError: null,
      });
      return true;
    } catch (error) {
      const mensaje = (error as Error).message.slice(0, 280);
      this.logger.warn(`El Motor no decidió la solicitud ${solicitud.id}: ${mensaje}`);
      await solicitud.update({ engineAttempts: solicitud.engineAttempts + 1, engineLastError: mensaje });
      return false;
    }
  }
}

/**
 * El veredicto traducido. Manda `dsr_decision` —la salida declarada del artefacto— y sólo se cae a `outcome` de respaldo.
 * Un desenlace que no es de los tres se guarda como REVISION_HUMANA con el valor original en el motivo: lo que no se
 * conoce lo mira una persona, nunca se acepta.
 */
export function toPrivacyVerdict(response: DecisionResponse): PrivacyEngineVerdict {
  const output = (response.output ?? {}) as Record<string, unknown>;
  const publicado = String(output.dsr_decision ?? response.outcome ?? '')
    .trim()
    .toUpperCase();
  const conocido = (PRIVACY_ENGINE_DECISIONS as readonly string[]).includes(publicado);
  const riesgo = Number(output.dsr_senales_riesgo);
  return {
    decision: conocido ? (publicado as PrivacyEngineDecision) : 'REVISION_HUMANA',
    reasonCode: conocido ? motivoPublicado(output, response) : `DESCONOCIDO:${publicado || 'vacio'}`.slice(0, 60),
    action: conocido && output.dsr_accion ? String(output.dsr_accion).slice(0, 30) : 'NINGUNA',
    riskSignals: Number.isFinite(riesgo) ? riesgo : null,
    reevaluateCredit: typeof output.dsr_reevaluar_credito === 'boolean' ? output.dsr_reevaluar_credito : null,
    executionId: response.executionId,
    artifactVersionId: response.artifact?.versionId ?? null,
  };
}

/** El motivo declarado (`dsr_motivo`) y, si el artefacto no lo rellenó, el primer código de motivo de la ejecución. */
function motivoPublicado(output: Record<string, unknown>, response: DecisionResponse): string | null {
  if (output.dsr_motivo) return String(output.dsr_motivo).slice(0, 60);
  return response.reasonCodes[0]?.code ?? null;
}
