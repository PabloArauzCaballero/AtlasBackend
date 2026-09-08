/**
 * @file Servicio de aplicación: la verificación del expediente del comercio la decide el Motor.
 * @business Traslada a una política versionada y auditable la decisión que habilita a un comercio a cobrar.
 * @system mapea el expediente a las variables del artefacto PARTNER_KYB_REVIEW y persiste su veredicto.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DecisionArtifactBindingService } from '../../decision-engine/decision-artifact-binding.service.js';
import { DecisionEngineClient } from '../../decision-engine/decision-engine.client.js';
import type { DecisionResponse } from '../../decision-engine/decision-engine.types.js';
import { env } from '../../../config/env.js';
import { PartnerProfileModel } from '../../../database/models/index.js';
import type { SubmissionGap } from './partner-profile.service.js';

/** Los desenlaces que publica el artefacto. Cualquier otro se trata como «no concluyente». */
export const KYB_OUTCOMES = ['APROBADO', 'RECHAZADO', 'REVISION_MANUAL'] as const;
export type KybOutcome = (typeof KYB_OUTCOMES)[number];

const COMPLETED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED']);

/**
 * Los requisitos DUROS: los cuatro que, si faltan, impiden cobrar. Se nombran aquí y no en el
 * artefacto porque son los huecos que Atlas ya sabe calcular (`findSubmissionGaps`); el artefacto
 * decide qué hacer con ellos, que es cosa distinta.
 */
const REQUISITO_POR_HUECO: Record<string, string> = {
  commercial_registry: 'kyb_tiene_matricula',
  legal_representative: 'kyb_representante_acreditado',
  power_of_attorney: 'kyb_representante_acreditado',
  business_qr: 'kyb_qr_negocio',
  bank_qr: 'kyb_qr_bancario',
};

export type KybDecision = {
  outcome: KybOutcome | string;
  reason: string | null;
  executionId: string;
  artifactVersionId: string | null;
  manualReviewCaseCode: string | null;
  requisitosFaltantes: number | null;
  senalesOperativas: number | null;
  evaluatedAt: Date;
};

@Injectable()
export class PartnerKybDecisionService {
  private readonly logger = new Logger(PartnerKybDecisionService.name);

  constructor(
    private readonly client: DecisionEngineClient,
    private readonly artifactBindings: DecisionArtifactBindingService,
  ) {}

  get isEnabled(): boolean {
    return this.client.isConfigured;
  }

  /**
   * Las siete variables del artefacto, derivadas del expediente y de sus huecos.
   *
   * Se mandan booleanos y números, **nunca los documentos**. Lo que el Motor decide es si el
   * requisito está cubierto; quién guarda la evidencia —con su hash y su cadena de custodia— es el
   * expediente. Copiar aquí el número de matrícula o la cuenta bancaria duplicaría datos
   * personales del comercio en un segundo sistema para no usarlos.
   */
  buildVariables(profile: PartnerProfileModel, gaps: SubmissionGap[], sucursales: number): Record<string, number | boolean> {
    const faltantes = new Set(gaps.map((gap) => REQUISITO_POR_HUECO[gap.requirement]).filter(Boolean));
    const abiertoDesde = profile.createdAtValue ?? new Date();
    const antiguedadDias = Math.max(0, Math.floor((Date.now() - new Date(abiertoDesde).getTime()) / 86_400_000));
    return {
      kyb_tiene_matricula: !faltantes.has('kyb_tiene_matricula'),
      kyb_representante_acreditado: !faltantes.has('kyb_representante_acreditado'),
      kyb_qr_negocio: !faltantes.has('kyb_qr_negocio'),
      kyb_qr_bancario: !faltantes.has('kyb_qr_bancario'),
      kyb_correo_verificado: profile.emailVerifiedAt !== null,
      kyb_sucursales: sucursales,
      // El artefacto la usa como SEÑAL (por encima de 120 días manda a revisión), no como rechazo:
      // un expediente que lleva medio año abierto pudo cambiar de manos desde que se empezó.
      kyb_antiguedad_dias: antiguedadDias,
    };
  }

  /**
   * Evalúa el expediente contra la política versionada del Motor.
   *
   * **Aquí no se degrada.** A diferencia del riesgo del alta de un cliente —donde caer a la
   * política local evita bloquear altas y el daño de esperar es mayor que el de decidir con la
   * heurística—, aquí una decisión local sería exactamente lo que este trabajo desmonta: la
   * consola volvería a ser el origen del veredicto, sin versión ni traza. Un comercio que espera
   * unas horas más a que el Motor vuelva es un coste asumible; un comercio habilitado a cobrar por
   * un camino sin política no lo es. Por eso lanza 503 y quien llama lo dice.
   */
  async evaluate(input: {
    tenantId: string;
    profile: PartnerProfileModel;
    gaps: SubmissionGap[];
    sucursales: number;
    /** Lo que hace que reintentar la misma petición no produzca dos ejecuciones. */
    idempotencyKey: string;
  }): Promise<KybDecision> {
    if (!this.client.isConfigured) {
      throw new ServiceUnavailableException('DECISION_ENGINE_UNAVAILABLE: el Motor no está configurado en este despliegue.');
    }

    const binding = await this.artifactBindings.resolve(String(input.tenantId), 'partner');
    const artifactCode = binding.artifactCode ?? env.DECISION_ENGINE_PARTNER_ARTIFACT;
    if (!artifactCode) {
      throw new ServiceUnavailableException('DECISION_ENGINE_UNAVAILABLE: no hay artefacto de comercio configurado.');
    }

    try {
      const response = await this.client.execute(artifactCode, {
        requestId: `kyb-${input.profile.id}-${input.idempotencyKey}`.slice(0, 120),
        idempotencyKey: input.idempotencyKey,
        correlationId: randomUUID(),
        // El expediente, no el comercio: es lo que el Motor puede usar para atribuir el desenlace
        // sin recibir el NIT ni la razón social.
        subjectReference: `partner:${input.profile.id}`,
        variables: this.buildVariables(input.profile, input.gaps, input.sucursales),
        context: { source: 'atlas-backend', module: 'partner-onboarding' },
      });

      if (!COMPLETED_STATUSES.has(response.status.toUpperCase())) {
        throw new ServiceUnavailableException(
          `DECISION_ENGINE_UNAVAILABLE: el Motor respondió ${response.status} y no un veredicto.`,
        );
      }

      return toKybDecision(response);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`El Motor no pudo verificar el expediente ${input.profile.id}: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        `DECISION_ENGINE_UNAVAILABLE: ${(error as Error).message}. El expediente queda como estaba.`,
      );
    }
  }
}

/**
 * El veredicto del Motor traducido al vocabulario del expediente.
 *
 * El desenlace se toma de `kyb_decision` —la salida DECLARADA del artefacto— y sólo se cae a
 * `outcome` como respaldo: son dos campos distintos y el que manda es el del contrato de salida,
 * que es el que el autor de la política eligió publicar.
 */
function toKybDecision(response: DecisionResponse): KybDecision {
  const output = (response.output ?? {}) as Record<string, unknown>;
  return {
    outcome: String(output.kyb_decision ?? response.outcome ?? '').toUpperCase(),
    reason: output.kyb_motivo ? String(output.kyb_motivo) : (response.reasonCodes[0]?.code ?? null),
    executionId: response.executionId,
    artifactVersionId: response.artifact?.versionId ?? null,
    manualReviewCaseCode: response.manualReview?.caseCode ?? null,
    requisitosFaltantes: numero(output.kyb_requisitos_faltantes),
    senalesOperativas: numero(output.kyb_senales_operativas),
    evaluatedAt: new Date(),
  };
}

function numero(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
