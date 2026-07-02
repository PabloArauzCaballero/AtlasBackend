import { env } from '../../../config/env.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt: number): number {
  return env.NOTIFICATION_PROVIDER_HTTP_RETRY_BASE_DELAY_MS * 2 ** attempt;
}

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

async function postWithRetry(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  let lastError: Error | null = null;
  const maxAttempts = env.NOTIFICATION_PROVIDER_HTTP_RETRIES + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.NOTIFICATION_PROVIDER_HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(input.url, {
        method: 'POST',
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const json = await parseResponseJson(response);
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === maxAttempts - 1) {
        return { ok: response.ok, status: response.status, json };
      }
      await sleep(retryDelay(attempt));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxAttempts - 1) break;
      await sleep(retryDelay(attempt));
    }
  }

  return {
    ok: false,
    status: 0,
    json: { error: lastError?.message ?? 'NOTIFICATION_PROVIDER_HTTP_FAILED' },
  };
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return postWithRetry({
    url,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export async function postForm(
  url: string,
  headers: Record<string, string>,
  body: Record<string, string>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return postWithRetry({
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

export function supportsOnly(expected: NotificationChannel, actual: NotificationChannel): boolean {
  return expected === actual;
}
