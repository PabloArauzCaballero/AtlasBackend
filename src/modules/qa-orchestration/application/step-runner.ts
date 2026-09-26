/**
 * @file Servicio de aplicación: ejecuta UN paso de una persona, de los bindings a la extracción.
 * @business Esta pieza envía la petición que la receta declaró, con la sesión de ESTA persona, y
 *   decide su resultado por el oráculo de negocio, no por el código HTTP.
 * @system bindings tipados → admisión y presupuesto → transporte con reintentos seguros → oráculo
 *   → extracción; la evidencia se sanea al guardarla, nunca antes de extraer.
 */
import { redactSensitiveObject } from '../../../common/utils/privacy/redaction.util.js';
import type { Expectation, RecipeStep } from '../domain/journey-recipe.types.js';
import { errorCodeOf, evaluateQaStep, selectExpectation, type StepVerdict } from '../domain/journey-assertions.js';
import { idempotencyKeyFor } from '../domain/run-accounting.js';
import { BindingUnresolvedError, interpolate, readOptional, resolveBinding, type BindingScope } from '../domain/typed-bindings.js';
import type { AttemptRecord, StepRecord, TransportResponse } from './executor.ports.js';
import type { PersonaExecutionDeps, PersonaExecutionInput } from './journey-executor.js';
import { syntheticImage } from '../fixtures/synthetic-upload.js';

const RATE_LIMIT_WAIT_MS = 61_000;
const MAX_RATE_LIMIT_RETRIES = 3;

export type StepBase = Pick<StepRecord, 'stepKey' | 'workflowStepCode' | 'visitIndex' | 'logicalOperationId' | 'failures' | 'attempts'>;
export type StepResult = Omit<StepRecord, 'startedAt' | 'finishedAt'>;

type Prepared = {
  path: string;
  body: unknown;
  query?: Record<string, string>;
  headers: Record<string, string>;
  expected: Expectation & { label: string };
};

export function summarize(body: unknown): unknown {
  const redacted = redactSensitiveObject(body);
  const text = JSON.stringify(redacted) ?? '';
  return text.length > 4_000 ? { truncated: true, preview: text.slice(0, 4_000) } : redacted;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    if (cursor[segment] === null || typeof cursor[segment] !== 'object') cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

function attemptOf(attempt: number, response: TransportResponse, admissionLagMs: number): AttemptRecord {
  const base = { attempt, latencyMs: Math.round(response.latencyMs), admissionLagMs: Math.round(admissionLagMs) };
  if (response.status === null) return { ...base, status: null, transportError: response.error };
  return {
    ...base,
    status: response.status,
    requestId: readOptional({ b: response.body }, 'b.requestId') as string | undefined,
    errorCode: errorCodeOf(response.body),
  };
}

export class StepRunner {
  private readonly attempts: AttemptRecord[] = [];
  private readonly evidence: StepRecord['evidence'];

  constructor(
    private readonly deps: PersonaExecutionDeps,
    private readonly step: RecipeStep,
    private readonly operationId: string,
    private readonly base: StepBase,
    private readonly input: PersonaExecutionInput,
  ) {
    this.evidence = { method: step.method, path: step.path };
  }

  private result(status: StepResult['status'], extra: Partial<StepResult> = {}): StepResult {
    return { ...this.base, status, attempts: this.attempts, evidence: this.evidence, ...extra };
  }

  /** Resuelve bindings y sesión. Un fallo aquí no gasta una sola petición. */
  private prepare(): Prepared | StepResult {
    const { step, input } = this;
    const scope = input.scope;
    let path: string;
    let body: unknown;
    let query: Record<string, string> | undefined;
    try {
      path = interpolate(step.path, scope);
      body = resolveBinding(step.body, scope);
      query = step.query
        ? Object.fromEntries(Object.entries(step.query).map(([key, value]) => [key, String(resolveBinding(value, scope))]))
        : undefined;
    } catch (error) {
      if (!(error instanceof BindingUnresolvedError)) throw error;
      return this.result('FAILED', {
        reason: error.message,
        failures: [{ code: 'BINDING_UNRESOLVED', message: error.message, path: error.path }],
      });
    }
    Object.assign(this.evidence, { path, requestBody: body === undefined ? undefined : summarize(body) });
    const headers: Record<string, string> = {};
    if (step.actor !== 'anonymous') {
      const token = readOptional(scope, `session.${step.actor}.accessToken`);
      if (typeof token !== 'string' || token === '') {
        return this.result('FAILED', {
          reason: `no hay sesión de ${step.actor} para esta persona`,
          failures: [{ code: 'BINDING_UNRESOLVED', message: `session.${step.actor}.accessToken` }],
        });
      }
      headers.authorization = `Bearer ${token}`;
    }
    if (step.idempotency === 'per_operation') headers['x-idempotency-key'] = idempotencyKeyFor(this.operationId);
    return { path, body, query, headers, expected: selectExpectation(step.expect, step.branches, scope) };
  }

  /** Un intento: cupo, presupuesto, escritura anticipada y envío; `stop` si no hubo cupo. */
  private async sendOnce(prepared: Prepared): Promise<{ response: TransportResponse } | { stop: StepResult }> {
    const { step, input } = this;
    const admissionLagMs = step.rateLimit
      ? (await this.deps.admission.admit(step.rateLimit.bucket, step.rateLimit.perMinute, input.signal)).admissionLagMs
      : 0;
    const slot = await this.deps.budget.acquire();
    if (!slot.ok) return { stop: this.result(slot.reason === 'CANCELLED' ? 'CANCELLED' : 'INDETERMINATE', { reason: slot.reason }) };
    const attempt = this.attempts.length + 1;
    // Escritura anticipada: si el worker muere con esta petición en vuelo, el reinicio verá RUNNING
    // y sabrá que el efecto es desconocido, en vez de creer que nunca se envió.
    if (step.method !== 'GET' && attempt === 1) {
      await this.deps.sink.record({ ...this.result('RUNNING', { attempts: [] }), startedAt: new Date().toISOString(), finishedAt: '' });
    }
    try {
      const response = await this.deps.transport.send({
        method: step.method,
        path: prepared.path,
        query: prepared.query,
        headers: {
          ...prepared.headers,
          ...this.deps.credential.headerFor({ personaKey: input.personaKey, logicalOperationId: this.operationId, attempt }),
        },
        body: prepared.body,
        timeoutMs: step.timeoutMs ?? input.defaultTimeoutMs,
        signal: input.signal,
      });
      this.attempts.push(attemptOf(attempt, response, admissionLagMs));
      return { response };
    } finally {
      slot.release();
    }
  }

  /** ¿Hay que repetir? 429 en paso limitado, transporte caído en paso seguro, o sondeo pendiente. */
  private async shouldRepeat(response: TransportResponse, expected: Prepared['expected'], deadline: number): Promise<boolean> {
    const { step, input } = this;
    if (input.signal.aborted) return false;
    const rateLimited = this.attempts.filter((entry) => entry.status === 429).length;
    if (response.status === 429 && step.rateLimit && rateLimited <= MAX_RATE_LIMIT_RETRIES) {
      // La ventana del backend es por IP, no por proceso: misma intención, misma clave, y la espera
      // cuenta como admisión, no como latencia.
      await this.deps.sleep(RATE_LIMIT_WAIT_MS, input.signal);
      return !input.signal.aborted;
    }
    const safe = step.method === 'GET' || step.idempotency === 'per_operation';
    if (response.status === null) return safe && this.attempts.length < Math.max(1, step.retry?.maxAttempts ?? 1);
    if (!step.poll || Date.now() >= deadline) return false;
    const done = evaluateQaStep({
      expected: { status: expected.status, assertions: step.poll.until },
      response: { status: response.status, body: response.body },
      scope: input.scope,
    });
    if (done.status === 'PASSED') return false;
    await this.deps.sleep(step.poll.intervalMs, input.signal);
    return !input.signal.aborted;
  }

  private extract(verdict: StepVerdict, body: unknown, cookies: Record<string, string> = {}): StepResult {
    const scope = this.input.scope as BindingScope & Record<string, unknown>;
    const extracted: Record<string, unknown> = {};
    for (const extraction of this.step.extract ?? []) {
      // Una cookie sólo puede ir a la sesión: un token nunca se extrae a `resources.*`.
      if (extraction.from.startsWith('cookies.') && !extraction.to.startsWith('session.')) continue;
      const value = readOptional({ ...scope, response: body, cookies }, extraction.from);
      if (value === undefined && extraction.required) {
        return this.result('FAILED', {
          branch: verdict.branch,
          reason: `la respuesta no trae ${extraction.from}, que los pasos siguientes necesitan`,
          failures: [{ code: 'ASSERTION_EXISTS_FAILED', message: `falta ${extraction.from}` }],
        });
      }
      if (value === undefined) continue;
      setPath(scope, extraction.to, value);
      // Los tokens se extraen a la sesión pero NUNCA a la evidencia.
      if (!extraction.to.startsWith('session.')) extracted[extraction.to] = value;
    }
    this.evidence.extracted = extracted;
    return this.result('PASSED', { branch: verdict.branch });
  }

  /**
   * Subida de bytes sintéticos a la URL firmada del paso anterior. La URL no se guarda en la
   * evidencia (lleva firma); sí el tamaño y el sha256 de lo subido, que el backend recalcula.
   */
  private async runUpload(upload: NonNullable<RecipeStep['upload']>): Promise<StepResult> {
    const url = readOptional(this.input.scope, upload.urlFrom);
    Object.assign(this.evidence, { path: '(URL firmada del almacenamiento QA)' });
    if (typeof url !== 'string') {
      return this.result('FAILED', {
        reason: `falta ${upload.urlFrom}`,
        failures: [{ code: 'BINDING_UNRESOLVED', message: upload.urlFrom }],
      });
    }
    const { bytes, sha256 } = syntheticImage(upload.image, this.input.personaKey);
    const slot = await this.deps.budget.acquire();
    if (!slot.ok) return this.result(slot.reason === 'CANCELLED' ? 'CANCELLED' : 'INDETERMINATE', { reason: slot.reason });
    let response: TransportResponse;
    try {
      response = await this.deps.transport.send({
        method: 'PUT',
        path: '',
        absoluteUrl: url,
        rawBody: bytes,
        headers: { 'content-type': 'image/jpeg' },
        timeoutMs: this.step.timeoutMs ?? this.input.defaultTimeoutMs,
        signal: this.input.signal,
      });
    } finally {
      slot.release();
    }
    this.attempts.push(attemptOf(1, response, 0));
    const verdict = evaluateQaStep({
      expected: { ...this.step.expect, label: 'subida' },
      response: response.status === null ? { status: null, transportError: response.error } : { status: response.status, body: null },
    });
    if (verdict.status !== 'PASSED')
      return this.result(verdict.status, { failures: verdict.failures, reason: verdict.failures[0]?.message });
    setPath(this.input.scope as Record<string, unknown>, upload.extractSha256To, sha256);
    this.evidence.extracted = { [upload.extractSha256To]: sha256, bytes: bytes.length };
    return this.result('PASSED');
  }

  /** Espera el código en el buzón QA hasta el plazo; nunca lo escribe en la evidencia. */
  private async runOtp(otp: NonNullable<RecipeStep['otp']>): Promise<StepResult> {
    const to = readOptional(this.input.scope, otp.toFrom);
    Object.assign(this.evidence, { path: `(buzón QA · ${otp.channel})` });
    if (!this.deps.inbox)
      return this.result('FAILED', {
        reason: 'no hay buzón QA en este entorno',
        failures: [{ code: 'BINDING_UNRESOLVED', message: 'inbox' }],
      });
    if (typeof to !== 'string')
      return this.result('FAILED', { reason: `falta ${otp.toFrom}`, failures: [{ code: 'BINDING_UNRESOLVED', message: otp.toFrom }] });
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const deadline = Date.now() + (otp.deadlineMs ?? 20_000);
    while (!this.input.signal.aborted) {
      const code = await this.deps.inbox.latestCode({ to, channel: otp.channel, sinceIso: since });
      if (code) {
        setPath(this.input.scope as Record<string, unknown>, otp.extractTo, code);
        this.evidence.extracted = { [otp.extractTo]: '[recibido en el buzón QA]' };
        return this.result('PASSED');
      }
      if (Date.now() >= deadline) break;
      await this.deps.sleep(1_000, this.input.signal);
    }
    if (this.input.signal.aborted) return this.result('CANCELLED', { reason: 'corrida cancelada esperando el código' });
    return this.result('FAILED', {
      reason: `no llegó ningún código por ${otp.channel} al buzón QA`,
      failures: [{ code: 'ASSERTION_EXISTS_FAILED', message: 'código ausente en el buzón' }],
    });
  }

  async run(): Promise<StepResult> {
    if (this.step.otp) return this.runOtp(this.step.otp);
    if (this.step.upload) return this.runUpload(this.step.upload);
    const prepared = this.prepare();
    if ('status' in prepared) return prepared;
    const deadline = this.step.poll ? Date.now() + this.step.poll.deadlineMs : 0;
    let response: TransportResponse;
    for (;;) {
      const sent = await this.sendOnce(prepared);
      if ('stop' in sent) return sent.stop;
      response = sent.response;
      if (!(await this.shouldRepeat(response, prepared.expected, deadline))) break;
    }
    return this.judge(response, prepared.expected);
  }

  private judge(response: TransportResponse, expected: Parameters<typeof evaluateQaStep>[0]['expected']): Promise<StepResult> | StepResult {
    const body = response.status === null ? null : response.body;
    this.evidence.responseSummary = summarize(body);
    // Cancelada con la petición sin respuesta o frenada por el límite de tasa: no es un fallo del
    // producto, es trabajo que se dejó de hacer. Una respuesta completa sí se juzga: ya tuvo efecto.
    if (this.input.signal.aborted && (response.status === null || response.status === 429)) {
      return this.result('CANCELLED', { reason: 'corrida cancelada con este paso en vuelo' });
    }
    const verdict = evaluateQaStep({
      expected,
      response:
        response.status === null ? { status: null, transportError: response.error } : { status: response.status, body: response.body },
      scope: this.input.scope,
    });
    if (verdict.status !== 'PASSED')
      return this.result(verdict.status, { branch: verdict.branch, failures: verdict.failures, reason: verdict.failures[0]?.message });
    return this.extract(verdict, body, response.status === null ? {} : response.cookies);
  }
}
