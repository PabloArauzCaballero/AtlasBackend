/**
 * @file Adaptador de infraestructura: habla con un sistema externo y traduce sus fallos.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system ejecuta decisiones y carga desenlaces contra el motor, con reintentos y circuito.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import { toAdapterError } from '../../common/resilience/adapter-error.js';
import { parseFacilityOutcomes, parseFacilityRegistrations } from './engine-verdicts.js';
import { EngineTransportService } from './engine-transport.service.js';
import {
  DecisionRequest,
  DecisionResponse,
  decisionResponseSchema,
  FacilityOutcomeInput,
  FacilityOutcomeResult,
  FacilityRegistrationInput,
  FacilityRegistrationOutcome,
  OutcomeObservationInput,
} from './decision-engine.types.js';

const PROVIDER = 'atlas_decision_engine';

@Injectable()
export class DecisionEngineClient {
  private readonly logger = new Logger(DecisionEngineClient.name);

  constructor(private readonly transport: EngineTransportService) {}

  /** Sin URL no hay integración, y quien llame debe poder distinguirlo de un motor que falla. */
  get isConfigured(): boolean {
    return Boolean(env.DECISION_ENGINE_BASE_URL && env.DECISION_ENGINE_API_KEY);
  }

  get canReportOutcomes(): boolean {
    return Boolean(env.DECISION_ENGINE_BASE_URL && env.DECISION_ENGINE_OUTCOME_API_KEY);
  }

  /**
   * Ejecuta una decisión contra el despliegue activo del artefacto.
   *
   * El 422 se devuelve como respuesta VÁLIDA y no como error. El motor lo usa para «la política
   * rechaza», que es un desenlace de negocio perfectamente normal y que hay que registrar con sus
   * motivos; tratarlo como fallo de transporte lo mandaría al camino de reintentos y acabaría
   * convertido en «motor no disponible», borrando justamente el rechazo que había que explicar.
   */
  async execute(artifactCode: string, request: DecisionRequest): Promise<DecisionResponse> {
    const url = `${this.transport.baseUrl()}/v1/decisions/${encodeURIComponent(artifactCode)}`;
    const raw = await this.transport.call(url, env.DECISION_ENGINE_API_KEY ?? '', {
      ...request,
      environmentCode: request.environmentCode ?? env.DECISION_ENGINE_ENVIRONMENT_CODE,
    });

    const parsed = decisionResponseSchema.safeParse(raw.json);
    if (!parsed.success) {
      throw toAdapterError({
        provider: PROVIDER,
        httpStatus: raw.status,
        message: `El motor respondió con una forma que el core no reconoce: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
      });
    }
    return parsed.data;
  }

  /**
   * Carga desenlaces observados. Va por el plano de GESTIÓN, con su propia credencial.
   *
   * El motor separa la audiencia `runtime` —que sólo ejecuta— del plano de gestión, y esta llamada
   * pertenece al segundo. Reutilizar aquí la llave de ejecución le daría al componente que decide
   * la capacidad de reescribir la medida de su propio acierto.
   */
  async recordOutcomes(observations: readonly OutcomeObservationInput[]): Promise<void> {
    if (observations.length === 0) return;
    const url = `${this.transport.baseUrl()}/v1/model-monitoring/outcomes`;
    await this.transport.call(url, env.DECISION_ENGINE_OUTCOME_API_KEY ?? '', { observations });
  }

  /**
   * Da de alta en el motor los créditos CONCEDIDOS, que es lo que ata un préstamo a la decisión
   * que lo aprobó y programa sus ventanas de observación.
   *
   * ## Por qué faltaba y qué rompía
   *
   * El core cargaba desenlaces por `executionId` contra `/v1/model-monitoring/outcomes`, pero nunca
   * daba de alta el CRÉDITO. Sin `credit_facility` el motor no tiene a qué atribuir el desenlace,
   * así que su matriz de cosechas sale vacía y la cobertura de desenlaces cae a `BREACH`. Y el
   * síntoma miente: el tablero enseña un motor que «no acierta» cuando lo que pasa es que nadie le
   * contó qué se concedió.
   *
   * ## Dos cosas que este método NO hace, a propósito
   *
   * No lanza si el motor rechaza una fila: la respuesta trae el veredicto de CADA crédito, y un
   * lote con una referencia mal formada no puede tumbar el alta de los otros veinte. Quien llama
   * decide qué hacer con los rechazos.
   *
   * Y no se reintenta aquí para siempre: el alta es idempotente en el motor —`upsert` por
   * `(tenant, externalReference)`, y reenviarla nunca reasigna el sujeto—, así que volver a
   * mandarla en el barrido siguiente es seguro y es preferible a bloquear un desembolso.
   */
  async registerFacilities(facilities: readonly FacilityRegistrationInput[]): Promise<FacilityRegistrationOutcome[]> {
    if (facilities.length === 0) return [];
    const url = `${this.transport.baseUrl()}/v1/outcomes/facilities`;
    const raw = await this.transport.call(url, env.DECISION_ENGINE_OUTCOME_API_KEY ?? '', { facilities });
    return parseFacilityRegistrations(raw.json);
  }

  /**
   * Carga desenlaces identificados por el CRÉDITO, que es el único camino que CIERRA la ventana.
   *
   * `/v1/model-monitoring/outcomes` guarda la observación pero no toca
   * `outcome_window_schedule`, así que la ventana sigue en la cola de pendientes para siempre y el
   * denominador de la cobertura no se mueve: el motor queda con observaciones cargadas y
   * reclamándolas a la vez. `/v1/outcomes/batch` escribe la observación **y** marca la ventana como
   * observada, y es además la clave que el sistema de cobranza conoce de verdad —el préstamo, no el
   * identificador interno de la ejecución que lo aprobó—.
   *
   * Devuelve el veredicto por fila porque un 200 con «1.998 aceptadas» deja sin saber cuáles fueron
   * las dos que no, y la reacción natural a eso es reenviar el archivo entero.
   */
  async recordFacilityOutcomes(outcomes: readonly FacilityOutcomeInput[]): Promise<FacilityOutcomeResult[]> {
    if (outcomes.length === 0) return [];
    const url = `${this.transport.baseUrl()}/v1/outcomes/batch`;
    const raw = await this.transport.call(url, env.DECISION_ENGINE_OUTCOME_API_KEY ?? '', { outcomes });
    return parseFacilityOutcomes(raw.json);
  }

  /**
   * Registra en el motor el permiso del titular para tratar sus datos.
   *
   * ## Por qué hacía falta
   *
   * El motor comprueba, antes de cada decisión, que ningún permiso registrado del sujeto esté
   * vencido o revocado. Pero el backend —que es quien RECOGE el consentimiento en el alta— nunca se
   * lo contaba. Resultado: el motor no tenía permisos que comprobar, así que la comprobación
   * siempre pasaba. El control existía sobre un conjunto vacío.
   *
   * ## Por qué no revienta la operación que lo llama
   *
   * Porque el permiso ya está registrado —y es válido— en el sistema donde vive el dato personal.
   * Esta llamada es una RÉPLICA para que el motor pueda ejercerlo; que falle deja al motor sin
   * enterarse, no al cliente sin derechos. Tumbar por eso un recálculo de línea cambiaría un
   * problema de sincronización por uno de servicio.
   */
  async recordConsent(input: {
    subjectReference: string;
    purpose: string;
    basis: 'CONSENT' | 'CONTRACT' | 'LEGAL_OBLIGATION' | 'CREDIT_PROTECTION' | 'LEGITIMATE_INTEREST';
    grantedAt: Date;
    expiresAt?: Date | null;
    evidenceRef?: string | null;
  }): Promise<boolean> {
    if (!this.isConfigured) return false;
    const url = `${this.transport.baseUrl()}/v1/risk-governance/consents`;
    const apiKey = env.DECISION_ENGINE_GOVERNANCE_API_KEY ?? env.DECISION_ENGINE_OUTCOME_API_KEY ?? '';
    try {
      await this.transport.call(url, apiKey, {
        subjectReference: input.subjectReference,
        purpose: input.purpose,
        basis: input.basis,
        grantedAt: input.grantedAt.toISOString(),
        ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
        ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
      });
      return true;
    } catch (error) {
      this.logger.warn(`No se pudo replicar el consentimiento en el motor: ${(error as Error).message}`);
      return false;
    }
  }

  /** Revoca el permiso en el motor. Misma tolerancia a fallo, y por el mismo motivo. */
  async revokeConsent(input: { subjectReference: string; purpose: string }): Promise<boolean> {
    if (!this.isConfigured) return false;
    const url = `${this.transport.baseUrl()}/v1/risk-governance/consents/revoke`;
    const apiKey = env.DECISION_ENGINE_GOVERNANCE_API_KEY ?? env.DECISION_ENGINE_OUTCOME_API_KEY ?? '';
    try {
      await this.transport.call(url, apiKey, { subjectReference: input.subjectReference, purpose: input.purpose });
      return true;
    } catch (error) {
      this.logger.warn(`No se pudo revocar el consentimiento en el motor: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Los artefactos que el motor tiene publicados.
   *
   * Es una LECTURA, así que no pasa por `call()` —que empuja un cuerpo y reintenta como si fuera
   * una decisión—: aquí un fallo no se reintenta, se traduce a lista vacía y la pantalla lo dice.
   * El catálogo sirve para poblar el desplegable de «qué artefacto decide cada cosa»; sin él se
   * escribía el código a mano, que es como se llegó a apuntar a uno inexistente.
   */
  async listArtifacts(): Promise<
    { artifactCode?: string; code?: string; name?: string; artifactType?: string; latestVersion?: string; latestStatus?: string }[]
  > {
    if (!this.isConfigured) return [];
    const url = `${this.transport.baseUrl()}/v1/artifacts`;
    const apiKey = env.DECISION_ENGINE_GOVERNANCE_API_KEY ?? env.DECISION_ENGINE_API_KEY ?? '';
    const response = await fetch(url, { headers: { 'x-api-key': apiKey, 'x-tenant-id': '1' } });
    if (!response.ok) {
      this.logger.warn(`El motor respondió ${response.status} al listar artefactos.`);
      return [];
    }
    const body = (await response.json()) as { data?: unknown; items?: unknown };
    const items = (body.data ?? body.items ?? body) as unknown;
    if (!Array.isArray(items)) return [];
    return items as {
      artifactCode?: string;
      code?: string;
      name?: string;
      artifactType?: string;
      latestVersion?: string;
      latestStatus?: string;
    }[];
  }

  /**
   * Cómo quedó un caso de revisión manual del motor.
   *
   * Es la vuelta del circuito que faltaba: el motor abre el caso y una persona lo resuelve EN SU
   * COLA, pero el expediente que lo originó vive en Atlas y no se enteraba. Sin esto, un comercio
   * aprobado por un analista en el motor seguía figurando «en revisión» aquí para siempre — y con
   * él, su QR sin resolver.
   *
   * Lectura, como el catálogo: un fallo no se reintenta ni tumba nada, devuelve `null` y quien
   * llama —un job— lo intentará en la pasada siguiente. Va por el plano de GESTIÓN: la llave de
   * ejecución no puede leer la bandeja.
   */
  async getManualReviewCase(caseCode: string): Promise<{
    caseCode: string;
    status: string;
    resolution: Record<string, unknown> | null;
    resolvedAt: string | null;
    assignedTo: string | null;
  } | null> {
    if (!this.isConfigured) return null;
    const url = `${this.transport.baseUrl()}/v1/manual-reviews/${encodeURIComponent(caseCode)}`;
    const apiKey = env.DECISION_ENGINE_GOVERNANCE_API_KEY ?? env.DECISION_ENGINE_API_KEY ?? '';
    try {
      const response = await fetch(url, { headers: { 'x-api-key': apiKey, 'x-tenant-id': '1' } });
      if (!response.ok) {
        this.logger.warn(`El motor respondió ${response.status} al leer el caso ${caseCode}.`);
        return null;
      }
      const body = (await response.json()) as Record<string, unknown>;
      const caso = (body.data ?? body ?? {}) as Record<string, unknown>;
      return {
        caseCode: String(caso.caseCode ?? caseCode),
        status: String(caso.status ?? ''),
        resolution: (caso.resolutionJson ?? caso.resolution ?? null) as Record<string, unknown> | null,
        resolvedAt: caso.resolvedAt ? String(caso.resolvedAt) : null,
        assignedTo: caso.assignedTo ? String(caso.assignedTo) : null,
      };
    } catch (error) {
      this.logger.warn(`No se pudo leer el caso ${caseCode} del motor: ${(error as Error).message}`);
      return null;
    }
  }
}
