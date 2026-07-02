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
  try {
    const base = mockBaseUrl.replace(/\/mock\/[a-z-]+$/i, '');
    const response = await fetch(`${base}/mock/health`);
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
      errorCode: 'MOCK_HEALTH_FAILED',
      errorMessageSafe: error instanceof Error ? error.message : 'Unknown mock health error',
    };
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
