/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { envNumber } from '../../../application/external-data-policy.util.js';
import {
  ExternalProviderExecutionInput,
  ExternalProviderRawResult,
  ProviderHealthResult,
} from '../../../domain/external-provider.types.js';

export async function callMockServer(input: ExternalProviderExecutionInput, path: string): Promise<ExternalProviderRawResult> {
  if (!input.mockBaseUrl) throw new Error(`${input.providerCode}_MOCK_BASE_URL_NOT_CONFIGURED`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const started = Date.now();
  try {
    const response = await fetch(`${input.mockBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.scenario ? { 'x-mock-scenario': input.scenario } : {}),
      },
      body: JSON.stringify({ scenario: input.scenario, input: input.input }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      payload = { invalidJson: true, raw: text.slice(0, 500) };
    }
    return {
      providerCode: input.providerCode,
      status: String(payload.status ?? response.status),
      statusCode: response.status,
      providerReference: typeof payload.providerReference === 'string' ? payload.providerReference : undefined,
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkMockHealth(
  providerCode: string,
  mode: ExternalProviderExecutionInput['mode'],
  mockBaseUrl?: string,
): Promise<ProviderHealthResult> {
  const started = Date.now();
  if (mode === 'disabled') {
    return { providerCode, status: 'DOWN', mode, latencyMs: 0, checkedAt: new Date().toISOString(), errorCode: 'PROVIDER_DISABLED' };
  }
  if (mode !== 'mock_server') {
    return { providerCode, status: 'UP', mode, latencyMs: 0, checkedAt: new Date().toISOString() };
  }
  if (!mockBaseUrl) {
    return { providerCode, status: 'DOWN', mode, latencyMs: 0, checkedAt: new Date().toISOString(), errorCode: 'MOCK_BASE_URL_MISSING' };
  }
  // Plazo propio: `getProviderHealth` recorre los nueve proveedores en serie y espera a cada uno.
  // Sin tope, un emulador que acepta la conexión y no contesta cuelga la pantalla entera del
  // portal, no una fila. Tres segundos son de sobra para un servicio de la misma máquina.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), envNumber('EXTERNAL_PROVIDERS_HEALTH_TIMEOUT_MS', 3_000));
  try {
    // Salud POR MÓDULO, no global. Antes se recortaba el path del proveedor y los nueve
    // preguntaban por `/mock/health`, así que los nueve compartían veredicto: con un solo módulo
    // caído, o se pintaban todos bien o se pintaban todos mal. El emulador expone
    // `/mock/health/<slug>` desde su primera versión.
    const match = /\/mock\/([a-z-]+)$/i.exec(mockBaseUrl);
    const base = mockBaseUrl.replace(/\/mock\/[a-z-]+$/i, '');
    const slug = match?.[1];
    const response = await fetch(`${base}/mock/health${slug ? `/${slug}` : ''}`, { signal: controller.signal });
    // Un 404 aquí es el módulo que no existe en el emulador, no el emulador caído: el proveedor
    // está configurado contra un path que nadie sirve, y eso es DEGRADED con causa, no DOWN.
    if (response.status === 404) {
      return {
        providerCode,
        status: 'DEGRADED',
        mode,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        errorCode: 'MOCK_MODULE_NOT_FOUND',
        errorMessageSafe: `El emulador no expone el módulo ${slug ?? providerCode}.`,
      };
    }
    return {
      providerCode,
      status: response.ok ? 'UP' : 'DEGRADED',
      mode,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      providerCode,
      status: 'DOWN',
      mode,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      errorCode: error instanceof Error && error.name === 'AbortError' ? 'MOCK_HEALTH_TIMEOUT' : 'MOCK_HEALTH_FAILED',
      errorMessageSafe: error instanceof Error ? error.message : 'Unknown mock health error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function scenarioFromInput(input: ExternalProviderExecutionInput): string {
  return input.scenario ?? (typeof input.input.scenario === 'string' ? input.input.scenario : 'happy_path');
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
