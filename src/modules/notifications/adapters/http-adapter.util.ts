import { env } from '../../../config/env.js';
import { toAdapterError } from '../../../common/resilience/adapter-error.js';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';

async function parseResponseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    return { text };
  }
  return { text };
}

export function getFirstDeliveryTarget(
  message: NotificationMessagePayload,
  kind: 'email' | 'phone' | 'fcm_token' | 'whatsapp',
): string | null {
  const target = message.deliveryTargets?.find((candidate) => candidate.kind === kind)?.address;
  if (target) return target;
  const keysByKind: Record<typeof kind, string[]> = {
    email: ['email', 'toEmail', 'recipientEmail'],
    phone: ['phone', 'toPhone', 'recipientPhone', 'smsTo'],
    whatsapp: ['whatsappTo', 'whatsapp', 'phone', 'toPhone', 'recipientPhone'],
    fcm_token: ['fcmToken', 'pushToken', 'deviceToken'],
  };
  for (const key of keysByKind[kind]) {
    const value = message.payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function getAllDeliveryTargets(message: NotificationMessagePayload, kind: 'email' | 'phone' | 'fcm_token' | 'whatsapp'): string[] {
  const fromTargets = (message.deliveryTargets ?? []).filter((candidate) => candidate.kind === kind).map((candidate) => candidate.address);
  const fallback = getFirstDeliveryTarget(message, kind);
  return Array.from(new Set([...fromTargets, ...(fallback ? [fallback] : [])]));
}

export function failedDelivery(provider: string, code: string, message: string, response?: Record<string, unknown>): DeliveryResult {
  return { status: 'failed', provider, providerMessageId: null, response: response ?? null, errorCode: code, errorMessage: message };
}

export function sentDelivery(provider: string, providerMessageId: string | null, response?: Record<string, unknown>): DeliveryResult {
  return { status: 'sent', provider, providerMessageId, response: response ?? null, errorCode: null, errorMessage: null };
}

async function fetchOnce(input: { url: string; headers: Record<string, string>; body: string }): Promise<{ status: number; ok: boolean; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.NOTIFICATION_PROVIDER_HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(input.url, { method: 'POST', headers: input.headers, body: input.body, signal: controller.signal });
    const json = await parseResponseJson(response);
    return { status: response.status, ok: response.ok, json };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Envoltura única para que CUALQUIER canal de notificación (email/sms/push/whatsapp, o uno
 * nuevo) obtenga retry+backoff y circuit breaker por proveedor "gratis" al llamar `postJson`/
 * `postForm` — la lógica de reintento y de apertura de circuito vive una sola vez en
 * `ResilientAdapterExecutorService` (`src/common/resilience/`), no aquí. Preserva el shape
 * `{ ok, status, json }` que ya usan los 4 adapters existentes: un fallo tras agotar reintentos
 * se traduce de vuelta a `ok: false` (no se propaga la excepción) para no tener que tocar cada
 * call site además de agregar el executor/provider.
 */
async function callResilient(
  executor: ResilientAdapterExecutorService,
  provider: string,
  request: { url: string; headers: Record<string, string>; body: string },
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  try {
    const result = await executor.run(
      async () => {
        const raw = await fetchOnce(request);
        if (!raw.ok) {
          throw toAdapterError({ provider, httpStatus: raw.status, message: `HTTP ${raw.status}`, error: raw.json });
        }
        return raw;
      },
      { provider, maxAttempts: env.NOTIFICATION_PROVIDER_HTTP_RETRIES + 1, baseDelayMs: env.NOTIFICATION_PROVIDER_HTTP_RETRY_BASE_DELAY_MS },
    );
    return { ok: true, status: result.status, json: result.json };
  } catch (error) {
    const adapterError = toAdapterError({ provider, error });
    return { ok: false, status: adapterError.httpStatus ?? 0, json: { error: adapterError.message, code: adapterError.code } };
  }
}

export async function postJson(
  executor: ResilientAdapterExecutorService,
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return callResilient(executor, provider, {
    url,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export async function postForm(
  executor: ResilientAdapterExecutorService,
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, string>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return callResilient(executor, provider, {
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

export function supportsOnly(expected: NotificationChannel, actual: NotificationChannel): boolean {
  return expected === actual;
}
