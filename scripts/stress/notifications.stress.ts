import jwt, { SignOptions } from 'jsonwebtoken';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { env } from '../../src/config/env.js';

function cleanBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

function cleanApiPrefix(raw: string): string {
  return raw.replace(/^\/+/, '').replace(/\/+$/, '');
}

const DEFAULT_BASE_URL = `http://localhost:${env.APP_PORT}/${cleanApiPrefix(env.API_PREFIX)}`;
const BASE_URL = cleanBaseUrl(process.env.BASE_URL ?? DEFAULT_BASE_URL);
const TENANT_ID = process.env.TENANT_ID ?? '1';
const CUSTOMER_ID = process.env.CUSTOMER_ID ?? '1';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} debe ser un número positivo.`);
  return Math.floor(parsed);
}

function boundedIntEnv(name: string, fallback: number, max: number): number {
  const value = intEnv(name, fallback);
  if (value > max) throw new Error(`${name} debe ser <= ${max}. El endpoint actual limita ese parámetro.`);
  return value;
}

function nonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} debe ser un entero >= 0.`);
  return Math.floor(parsed);
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} debe ser un número >= 0.`);
  return parsed;
}

const CONFIG = {
  events: intEnv('STRESS_EVENTS', 500),
  createConcurrency: intEnv('STRESS_CREATE_CONCURRENCY', 20),
  processBatch: boundedIntEnv('STRESS_PROCESS_BATCH', 100, 500),
  processRounds: intEnv('STRESS_PROCESS_ROUNDS', 50),
  idleRoundsToStop: intEnv('STRESS_IDLE_ROUNDS_TO_STOP', 2),
  processRoundDelayMs: nonNegativeIntEnv('STRESS_PROCESS_ROUND_DELAY_MS', 100),
  eventCode: process.env.STRESS_EVENT_CODE ?? 'user.email.verified',
  aggregateType: process.env.STRESS_AGGREGATE_TYPE ?? 'customer',
  expectedMessagesPerEvent: intEnv('STRESS_EXPECT_MESSAGES_PER_EVENT', 1),
  maxCreateErrorRatePct: numberEnv('STRESS_MAX_CREATE_ERROR_RATE_PCT', 1),
  maxProcessFailed: nonNegativeIntEnv('STRESS_MAX_PROCESS_FAILED', 0),
  maxP95CreateMs: numberEnv('STRESS_MAX_P95_CREATE_MS', 0),
  httpTimeoutMs: intEnv('STRESS_HTTP_TIMEOUT_MS', 30_000),
  httpRetries: nonNegativeIntEnv('STRESS_HTTP_RETRIES', 2),
  httpRetryBaseDelayMs: intEnv('STRESS_HTTP_RETRY_BASE_DELAY_MS', 250),
  verifyPageLimit: boundedIntEnv('STRESS_VERIFY_PAGE_LIMIT', 100, 100),
  createSpacingMs: nonNegativeIntEnv('STRESS_CREATE_SPACING_MS', 0),
};

type Role = 'admin' | 'customer' | 'system';

type HttpResult = {
  status: number;
  ms: number;
  data: unknown;
  text: string;
};

type Summary = {
  ok: number;
  failed: number;
  latencies: number[];
  firstErrors: string[];
};

function configuredToken(role: Role): string | null {
  if (role === 'admin') return process.env.STRESS_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? null;
  if (role === 'customer') return process.env.STRESS_CUSTOMER_TOKEN ?? process.env.CUSTOMER_TOKEN ?? null;
  return process.env.STRESS_SYSTEM_TOKEN ?? process.env.SYSTEM_TOKEN ?? null;
}

function makeToken(role: Role): string {
  const externalToken = configuredToken(role);
  if (externalToken) return externalToken;

  const payload = {
    sub: `${role}-stress`,
    role,
    tenantId: TENANT_ID,
    ...(role === 'customer' ? { customerId: CUSTOMER_ID } : { internalUserId: '1' }),
  };
  const options: SignOptions = { algorithm: 'HS256', expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_ACCESS_TOKEN_SECRET, options);
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function retryableStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function http(input: {
  method: string;
  path: string;
  role?: Role;
  body?: unknown;
  idempotencyKey?: string;
  expected?: number[];
}): Promise<HttpResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-tenant-id': TENANT_ID,
    'x-request-id': `stress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  if (input.role) headers.authorization = `Bearer ${makeToken(input.role)}`;
  if (input.idempotencyKey) headers['x-idempotency-key'] = input.idempotencyKey;

  const expected = input.expected ?? [200, 201, 202, 204];
  const url = `${BASE_URL}${input.path}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= CONFIG.httpRetries; attempt += 1) {
    const started = performance.now();
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: input.method,
          headers,
          body: input.body === undefined ? undefined : JSON.stringify(input.body),
        },
        CONFIG.httpTimeoutMs,
      );
      const text = await response.text();
      const data = parseBody(text);
      const ms = performance.now() - started;
      if (expected.includes(response.status)) return { status: response.status, ms, data, text };

      const message = `${input.method} ${input.path} expected ${expected.join('/')} got ${response.status}: ${text.slice(0, 700)}`;
      if (attempt < CONFIG.httpRetries && retryableStatus(response.status)) {
        await sleep(CONFIG.httpRetryBaseDelayMs * (attempt + 1));
        continue;
      }
      throw new Error(message);
    } catch (error) {
      lastError = error;
      if (attempt < CONFIG.httpRetries) {
        await sleep(CONFIG.httpRetryBaseDelayMs * (attempt + 1));
        continue;
      }
    }
  }

  throw new Error(errorMessage(lastError));
}

async function runPool(total: number, concurrency: number, worker: (index: number) => Promise<number>): Promise<Summary> {
  const summary: Summary = { ok: 0, failed: 0, latencies: [], firstErrors: [] };
  let cursor = 0;

  async function loop(): Promise<void> {
    while (cursor < total) {
      const current = cursor;
      cursor += 1;
      try {
        const ms = await worker(current);
        summary.ok += 1;
        summary.latencies.push(ms);
      } catch (error) {
        summary.failed += 1;
        if (summary.firstErrors.length < 10) summary.firstErrors.push(errorMessage(error));
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => loop());
  await Promise.all(workers);
  return summary;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function ratePerSecond(count: number, ms: number): number {
  if (count <= 0 || ms <= 0) return 0;
  return Number((count / (ms / 1000)).toFixed(2));
}

function pushObjectCandidate(candidates: unknown[], value: unknown): void {
  if (typeof value === 'object' && value !== null) candidates.push(value);
}

function responseCandidates(value: unknown): unknown[] {
  const candidates: unknown[] = [];
  pushObjectCandidate(candidates, value);

  if (typeof value !== 'object' || value === null) return candidates;
  const root = value as Record<string, unknown>;
  pushObjectCandidate(candidates, root.data);
  pushObjectCandidate(candidates, root.result);
  pushObjectCandidate(candidates, root.resultJson);

  if (typeof root.data === 'object' && root.data !== null) {
    const data = root.data as Record<string, unknown>;
    pushObjectCandidate(candidates, data.result);
    pushObjectCandidate(candidates, data.resultJson);
  }

  if (typeof root.result === 'object' && root.result !== null) {
    const result = root.result as Record<string, unknown>;
    pushObjectCandidate(candidates, result.data);
    pushObjectCandidate(candidates, result.resultJson);
  }

  return candidates;
}

function readNumber(value: unknown, keys: string[], fallback = 0): number {
  for (const candidate of responseCandidates(value)) {
    const record = candidate as Record<string, unknown>;
    for (const key of keys) {
      const raw = record[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
    }
  }
  return fallback;
}

function readPaginationTotal(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const pagination =
    typeof record.pagination === 'object' && record.pagination !== null ? (record.pagination as Record<string, unknown>) : null;
  const nested = typeof record.data === 'object' && record.data !== null ? (record.data as Record<string, unknown>) : null;
  const nestedPagination =
    nested && typeof nested.pagination === 'object' && nested.pagination !== null ? (nested.pagination as Record<string, unknown>) : null;
  const total = pagination?.total ?? nestedPagination?.total;
  if (typeof total === 'number') return total;
  if (typeof total === 'string' && Number.isFinite(Number(total))) return Number(total);
  return null;
}

function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }
  return search.toString();
}

async function getTotalFromOperationsMessages(
  params: Record<string, string | number | boolean | null | undefined>,
): Promise<number | null> {
  const result = await http({
    method: 'GET',
    path: `/operations/notifications/messages?${queryString({ ...params, page: 1, limit: CONFIG.verifyPageLimit })}`,
    role: 'admin',
  });
  return readPaginationTotal(result.data);
}

async function getTotalFromEvents(params: Record<string, string | number | boolean | null | undefined>): Promise<number | null> {
  const result = await http({
    method: 'GET',
    path: `/operations/events?${queryString({ ...params, page: 1, limit: CONFIG.verifyPageLimit })}`,
    role: 'admin',
  });
  return readPaginationTotal(result.data);
}

async function main(): Promise<void> {
  const runId = `stress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();
  const startedIso = startedAt.toISOString();
  const globalStarted = performance.now();

  console.log('[STRESS CONFIG]', JSON.stringify({ BASE_URL, TENANT_ID, CUSTOMER_ID, runId, ...CONFIG }, null, 2));
  console.log('[STRESS NOTE] En remoto usa STRESS_ADMIN_TOKEN y STRESS_CUSTOMER_TOKEN si no quieres generar JWT locales.');
  console.log(
    '[STRESS NOTE] Para pruebas locales fuertes, sube API_RATE_LIMIT_MAX en el backend antes de arrancarlo. Ejemplo: API_RATE_LIMIT_MAX=200000.',
  );

  await http({ method: 'GET', path: '/health' });

  const createStarted = performance.now();
  const createSummary = await runPool(CONFIG.events, CONFIG.createConcurrency, async (index) => {
    if (CONFIG.createSpacingMs > 0) await sleep(CONFIG.createSpacingMs);
    const key = `${runId}-event-${index}`;
    const result = await http({
      method: 'POST',
      path: '/operations/events',
      role: 'admin',
      idempotencyKey: key,
      body: {
        eventCode: CONFIG.eventCode,
        aggregateType: CONFIG.aggregateType,
        aggregateId: CONFIG.aggregateType === 'customer' ? CUSTOMER_ID : `${runId}-${index}`,
        payload: {
          customerId: CUSTOMER_ID,
          stress: true,
          runId,
          sequence: index,
          amount: 100 + (index % 50),
          dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        },
        metadata: { source: 'stress', runId, sequence: index },
        idempotencyKey: key,
        correlationId: runId,
        sourceModule: 'stress',
        sourceAction: 'notifications_stress',
      },
    });
    return result.ms;
  });
  const createMs = performance.now() - createStarted;

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let selected = 0;
  let idleRounds = 0;
  const processLatencies: number[] = [];
  const processStarted = performance.now();

  for (let round = 1; round <= CONFIG.processRounds; round += 1) {
    const result = await http({
      method: 'POST',
      path: '/operations/jobs/process-events',
      role: 'admin',
      idempotencyKey: `${runId}-process-${round}`,
      body: { limit: CONFIG.processBatch, dryRun: false },
    });
    processLatencies.push(result.ms);
    const roundSelected = readNumber(result.data, ['selected']);
    const roundProcessed = readNumber(result.data, ['processed']);
    const roundFailed = readNumber(result.data, ['failed']);
    const roundSkipped = readNumber(result.data, ['skipped']);
    selected += roundSelected;
    processed += roundProcessed;
    failed += roundFailed;
    skipped += roundSkipped;
    console.log(
      `[STRESS PROCESS] round=${round} selected=${roundSelected} processed=${roundProcessed} failed=${roundFailed} skipped=${roundSkipped} ms=${Math.round(result.ms)}`,
    );
    if (roundSelected === 0) idleRounds += 1;
    else idleRounds = 0;
    if (idleRounds >= CONFIG.idleRoundsToStop) break;
    if (CONFIG.processRoundDelayMs > 0) await sleep(CONFIG.processRoundDelayMs);
  }
  const processMs = performance.now() - processStarted;

  const expectedMinimumMessages = CONFIG.events * CONFIG.expectedMessagesPerEvent;
  const inAppTotalByCorrelation = await getTotalFromOperationsMessages({
    recipientType: 'customer',
    recipientId: CUSTOMER_ID,
    channel: 'in_app',
    correlationId: runId,
  });
  const createdEventsByCorrelation = await getTotalFromEvents({ correlationId: runId, eventCode: CONFIG.eventCode });
  const failedEventsByCorrelation = await getTotalFromEvents({ correlationId: runId, eventCode: CONFIG.eventCode, status: 'failed' });

  const customerInAppResult = await http({
    method: 'GET',
    path: `/customers/${CUSTOMER_ID}/notifications?channel=in_app&from=${encodeURIComponent(startedIso)}&page=1&limit=${CONFIG.verifyPageLimit}`,
    role: 'customer',
  });
  const customerInAppTotalSinceStart = readPaginationTotal(customerInAppResult.data);

  const totalMs = performance.now() - globalStarted;
  const createErrorRate = CONFIG.events === 0 ? 0 : (createSummary.failed / CONFIG.events) * 100;
  const createP95Ms = Math.round(percentile(createSummary.latencies, 95));

  const report = {
    runId,
    startedAt: startedIso,
    finishedAt: new Date().toISOString(),
    config: CONFIG,
    create: {
      ok: createSummary.ok,
      failed: createSummary.failed,
      errorRatePct: Number(createErrorRate.toFixed(2)),
      totalMs: Math.round(createMs),
      throughputPerSecond: ratePerSecond(createSummary.ok, createMs),
      p50Ms: Math.round(percentile(createSummary.latencies, 50)),
      p95Ms: createP95Ms,
      p99Ms: Math.round(percentile(createSummary.latencies, 99)),
      firstErrors: createSummary.firstErrors,
    },
    process: {
      selected,
      processed,
      failed,
      skipped,
      totalMs: Math.round(processMs),
      throughputPerSecond: ratePerSecond(processed, processMs),
      p50RoundMs: Math.round(percentile(processLatencies, 50)),
      p95RoundMs: Math.round(percentile(processLatencies, 95)),
    },
    verification: {
      createdEventsByCorrelation,
      failedEventsByCorrelation,
      inAppMessagesByCorrelation: inAppTotalByCorrelation,
      customerInAppNotificationsSinceStart: customerInAppTotalSinceStart,
      expectedMinimumMessages,
      note: 'La verificación fuerte usa correlationId/runId en endpoints de operaciones. La consulta de customer es secundaria porque puede mezclar pruebas simultáneas del mismo customer.',
    },
    totalMs: Math.round(totalMs),
  };

  console.log('[STRESS REPORT]', JSON.stringify(report, null, 2));

  if (createErrorRate > CONFIG.maxCreateErrorRatePct) {
    const hasRateLimitErrors = createSummary.firstErrors.some(
      (message) => message.includes('429') || message.includes('RATE_LIMIT_EXCEEDED'),
    );
    const rateLimitHint = hasRateLimitErrors
      ? ' Se detectaron 429/RATE_LIMIT_EXCEEDED. Reinicia el backend con API_RATE_LIMIT_MAX alto en la MISMA terminal donde corres yarn start:dev, o baja STRESS_CREATE_CONCURRENCY/STRESS_EVENTS.'
      : '';
    throw new Error(
      `Create error rate ${createErrorRate.toFixed(2)}% supera máximo permitido ${CONFIG.maxCreateErrorRatePct}%.${rateLimitHint}`,
    );
  }
  if (CONFIG.maxP95CreateMs > 0 && createP95Ms > CONFIG.maxP95CreateMs) {
    throw new Error(`Create p95 ${createP95Ms}ms supera máximo permitido ${CONFIG.maxP95CreateMs}ms.`);
  }
  if (createSummary.ok !== CONFIG.events) {
    throw new Error(`No se crearon todos los eventos: ok=${createSummary.ok}, expected=${CONFIG.events}.`);
  }
  if (createdEventsByCorrelation !== null && createdEventsByCorrelation < CONFIG.events) {
    throw new Error(`Eventos creados por correlationId insuficientes: total=${createdEventsByCorrelation}, expected>=${CONFIG.events}.`);
  }
  if (processed < CONFIG.events) {
    throw new Error(
      `No se procesaron todos los eventos creados: processed=${processed}, expected>=${CONFIG.events}. Revisa backlog, max rounds o fallos.`,
    );
  }
  if (failed > CONFIG.maxProcessFailed) {
    throw new Error(`Eventos fallidos durante procesamiento: failed=${failed}, max=${CONFIG.maxProcessFailed}.`);
  }
  if (failedEventsByCorrelation !== null && failedEventsByCorrelation > CONFIG.maxProcessFailed) {
    throw new Error(`Eventos failed en outbox para runId=${runId}: total=${failedEventsByCorrelation}, max=${CONFIG.maxProcessFailed}.`);
  }
  if (inAppTotalByCorrelation !== null && inAppTotalByCorrelation < expectedMinimumMessages) {
    throw new Error(
      `No se verificó el mínimo exacto de notificaciones in_app por correlationId: total=${inAppTotalByCorrelation}, expected>=${expectedMinimumMessages}.`,
    );
  }
}

main().catch((error) => {
  console.error('[STRESS FAILED]', errorMessage(error));
  process.exit(1);
});
