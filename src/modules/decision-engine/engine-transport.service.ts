/**
 * @file Adaptador de infraestructura: el transporte HTTP hacia el motor, con reintento y circuito.
 * @business Aísla «el motor no contesta» de «el motor dice que no», que son cosas distintas.
 * @system resuelve la URL base, aplica tiempo de espera y reintentos, y normaliza el cuerpo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import { toAdapterError } from '../../common/resilience/adapter-error.js';
import { ResilientAdapterExecutorService } from '../../common/resilience/resilient-adapter-executor.service.js';

const PROVIDER = 'atlas_decision_engine';

/** Un 422 es la política diciendo que no. No se reintenta: la respuesta sería idéntica. */
const BUSINESS_REJECTION_STATUS = 422;

export type EngineRawResult = { status: number; ok: boolean; json: Record<string, unknown> };

/**
 * Todo lo que hay entre el core y el motor que NO es el contrato de un endpoint.
 *
 * Vive aparte del cliente por dos motivos que se ven al leerlo:
 *
 * 1. **El 422 se trata como respuesta y no como error de transporte.** El motor lo usa para «la
 *    política rechaza», que es un desenlace de negocio normal y hay que registrar con sus motivos;
 *    pasarlo por el camino de reintentos lo convertiría en «motor no disponible» y borraría
 *    justamente el rechazo que había que explicar. Esa regla es del transporte, no de cada llamada,
 *    y tenerla en un solo sitio evita que la siguiente llamada que alguien añada la olvide.
 * 2. **El cuerpo no-JSON no revienta.** Un proxy delante del motor puede devolver HTML; convertir
 *    eso en una excepción de parseo escondería el código de estado, que es el dato útil.
 */
@Injectable()
export class EngineTransportService {
  private readonly logger = new Logger(EngineTransportService.name);

  constructor(private readonly executor: ResilientAdapterExecutorService) {}

  baseUrl(): string {
    const base = env.DECISION_ENGINE_BASE_URL;
    if (!base) throw toAdapterError({ provider: PROVIDER, message: 'DECISION_ENGINE_BASE_URL no está configurada.' });
    return base.replace(/\/+$/, '');
  }

  async call(url: string, apiKey: string, body: Record<string, unknown>): Promise<EngineRawResult> {
    return this.executor.run(
      async () => {
        const raw = await this.fetchOnce(url, apiKey, body);
        if (raw.status === BUSINESS_REJECTION_STATUS) return raw;
        if (!raw.ok) {
          throw toAdapterError({ provider: PROVIDER, httpStatus: raw.status, message: `HTTP ${raw.status}`, error: raw.json });
        }
        return raw;
      },
      {
        provider: PROVIDER,
        maxAttempts: env.DECISION_ENGINE_RETRIES + 1,
        baseDelayMs: env.DECISION_ENGINE_RETRY_BASE_DELAY_MS,
      },
    );
  }

  private async fetchOnce(url: string, apiKey: string, body: Record<string, unknown>): Promise<EngineRawResult> {
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
