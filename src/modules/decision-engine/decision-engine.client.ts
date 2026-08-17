/**
 * @file Adaptador de infraestructura: habla con un sistema externo y traduce sus fallos.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system ejecuta decisiones y carga desenlaces contra el motor, con reintentos y circuito.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import { toAdapterError } from '../../common/resilience/adapter-error.js';
import { ResilientAdapterExecutorService } from '../../common/resilience/resilient-adapter-executor.service.js';
import { DecisionRequest, DecisionResponse, decisionResponseSchema, OutcomeObservationInput } from './decision-engine.types.js';

const PROVIDER = 'atlas_decision_engine';

/** Un 422 es la política diciendo que no. No se reintenta: la respuesta sería idéntica. */
const BUSINESS_REJECTION_STATUS = 422;

type RawResult = { status: number; ok: boolean; json: Record<string, unknown> };

@Injectable()
export class DecisionEngineClient {
  private readonly logger = new Logger(DecisionEngineClient.name);

  constructor(private readonly executor: ResilientAdapterExecutorService) {}

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
    const url = `${this.baseUrl()}/v1/decisions/${encodeURIComponent(artifactCode)}`;
    const raw = await this.call(url, env.DECISION_ENGINE_API_KEY ?? '', {
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
    const url = `${this.baseUrl()}/v1/model-monitoring/outcomes`;
    await this.call(url, env.DECISION_ENGINE_OUTCOME_API_KEY ?? '', { observations });
  }

  private baseUrl(): string {
    const base = env.DECISION_ENGINE_BASE_URL;
    if (!base) throw toAdapterError({ provider: PROVIDER, message: 'DECISION_ENGINE_BASE_URL no está configurada.' });
    return base.replace(/\/+$/, '');
  }

  private async call(url: string, apiKey: string, body: Record<string, unknown>): Promise<RawResult> {
    const result = await this.executor.run(
      async () => {
        const raw = await this.fetchOnce(url, apiKey, body);
        if (raw.status === BUSINESS_REJECTION_STATUS) return raw;
        if (!raw.ok) {
          throw toAdapterError({
            provider: PROVIDER,
            httpStatus: raw.status,
            message: `HTTP ${raw.status}`,
            error: raw.json,
          });
        }
        return raw;
      },
      {
        provider: PROVIDER,
        maxAttempts: env.DECISION_ENGINE_RETRIES + 1,
        baseDelayMs: env.DECISION_ENGINE_RETRY_BASE_DELAY_MS,
      },
    );
    return result;
  }

  private async fetchOnce(url: string, apiKey: string, body: Record<string, unknown>): Promise<RawResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.DECISION_ENGINE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return { status: response.status, ok: response.ok, json: await this.parseJson(response) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text().catch(() => '');
    if (!text) return {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      this.logger.warn(`El motor devolvió un cuerpo no-JSON (${response.status}).`);
    }
    return { text };
  }
}
