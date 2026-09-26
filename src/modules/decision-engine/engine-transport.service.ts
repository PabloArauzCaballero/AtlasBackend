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

/** Ajustes de UNA llamada: plazo propio o menos intentos que los del entorno. */
export type OpcionesDeLlamada = { timeoutMs?: number; maxAttempts?: number };

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

  /**
   * `opciones` permite a una llamada concreta pedir un plazo mayor o renunciar a los reintentos:
   * la identidad (OCR + cara) tarda más que el plazo general y su reintento sólo produce un 409.
   */
  async call(url: string, apiKey: string, body: Record<string, unknown>, opciones: OpcionesDeLlamada = {}): Promise<EngineRawResult> {
    return this.executor.run(
      async () => {
        const raw = await this.fetchOnce(url, apiKey, body, opciones.timeoutMs ?? env.DECISION_ENGINE_TIMEOUT_MS);
        if (raw.status === BUSINESS_REJECTION_STATUS) return raw;
        if (!raw.ok) {
          throw toAdapterError({ provider: PROVIDER, httpStatus: raw.status, message: `HTTP ${raw.status}`, error: raw.json });
        }
        return raw;
      },
      {
        provider: PROVIDER,
        maxAttempts: opciones.maxAttempts ?? env.DECISION_ENGINE_RETRIES + 1,
        baseDelayMs: env.DECISION_ENGINE_RETRY_BASE_DELAY_MS,
      },
    );
  }

  private async fetchOnce(url: string, apiKey: string, body: Record<string, unknown>, timeoutMs: number): Promise<EngineRawResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

/**
 * El código de error del motor (`ProblemDetails.error.code`, p. ej. `CONSENT_GRANT_REPLAYED`) de un
 * fallo del transporte, o `null` si no lo trae. El transporte guarda el cuerpo como `cause`.
 */
export function engineErrorCode(error: unknown): string | null {
  const cause = (error as { cause?: unknown } | null)?.cause as { error?: { code?: unknown }; title?: unknown } | undefined;
  const code = cause?.error?.code ?? cause?.title;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/** El status HTTP de un fallo del transporte, si lo trae. */
export function engineErrorStatus(error: unknown): number | null {
  const status = (error as { httpStatus?: unknown } | null)?.httpStatus;
  return typeof status === 'number' ? status : null;
}
