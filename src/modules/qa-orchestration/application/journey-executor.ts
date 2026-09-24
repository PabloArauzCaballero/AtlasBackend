/**
 * @file Servicio de aplicación: ejecuta el recorrido de UNA persona sobre una receta congelada.
 * @business Esta pieza hace que una persona sintética avance por los pasos que le corresponden,
 *   con su propia sesión, y que un fallo detenga a sus dependientes en vez de producir ruido.
 * @system grafo en orden topológico; bindings tipados; oráculo por paso; reintentos sólo seguros.
 *
 * Reglas que hacen que el resultado signifique algo:
 * - La sesión del actor vive en `scope.session` de ESTA persona y no se persiste ni se exporta.
 * - Los extractores leen la respuesta REAL; la sanitización se aplica sólo al guardar evidencia
 *   (H06: el runner del navegador sanitizaba antes de extraer y perdía el token de sesión).
 * - Un paso cuya dependencia no pasó se marca SKIPPED_DEPENDENCY con su causa raíz; nunca suma.
 * - Una escritura sin respuesta es INDETERMINATE y detiene a los dependientes: no se reenvía a ciegas.
 */
import { redactSensitiveObject } from '../../../common/utils/privacy/redaction.util.js';
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { errorCodeOf, evaluateQaStep, selectExpectation, type StepVerdict } from '../domain/journey-assertions.js';
import { idempotencyKeyFor, logicalOperationId } from '../domain/run-accounting.js';
import type { QaStepStatus } from '../domain/qa-run.types.js';
import { BindingUnresolvedError, evaluateCondition, interpolate, readOptional, resolveBinding, type BindingScope } from '../domain/typed-bindings.js';
import type { AdmissionPort, AttemptRecord, BudgetPort, QaCredentialPort, QaTransport, StepRecord, StepSink } from './executor.ports.js';

export type PersonaExecutionInput = {
  tenantId: string;
  runId: string;
  personaKey: string;
  template: JourneyTemplate;
  /** Persona, fixtures y run ya resueltos. `resources`/`session` empiezan vacíos o desde checkpoint. */
  scope: BindingScope & { resources: Record<string, unknown>; session: Record<string, Record<string, unknown>> };
  /** Pasos ya confirmados en un intento anterior del worker: no se repiten. */
  completed?: Map<string, StepRecord>;
  signal: AbortSignal;
  defaultTimeoutMs: number;
};

export type PersonaExecutionDeps = {
  transport: QaTransport;
  admission: AdmissionPort;
  budget: BudgetPort;
  credential: QaCredentialPort;
  sink: StepSink;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
};

const PASSING_DEPENDENCY: readonly QaStepStatus[] = ['PASSED', 'NOT_APPLICABLE'];
const RATE_LIMIT_WAIT_MS = 61_000;
const MAX_RATE_LIMIT_RETRIES = 3;

function summarize(body: unknown): unknown {
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

function dependenciesOf(steps: RecipeStep[], index: number): string[] {
  return steps[index].dependsOn ?? (index === 0 ? [] : [steps[index - 1].stepKey]);
}

export class JourneyExecutor {
  constructor(private readonly deps: PersonaExecutionDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  /** Recorre la receta completa y devuelve el estado de cada paso, en orden. */
  async run(input: PersonaExecutionInput): Promise<StepRecord[]> {
    const results = new Map<string, StepRecord>(input.completed ?? []);
    const steps = input.template.steps;

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (results.has(step.stepKey)) continue;
      const operationId = logicalOperationId({ tenantId: input.tenantId, runId: input.runId, personaKey: input.personaKey, stepKey: step.stepKey, visitIndex: 0 });
      const base = { stepKey: step.stepKey, workflowStepCode: step.workflowStepCode, visitIndex: 0, logicalOperationId: operationId, failures: [], attempts: [] };
      const startedAt = this.now();
      const close = async (record: Omit<StepRecord, 'startedAt' | 'finishedAt'>): Promise<void> => {
        const full = { ...record, startedAt, finishedAt: this.now() };
        results.set(step.stepKey, full);
        await this.deps.sink.record(full);
      };

      if (input.signal.aborted) {
        await close({ ...base, status: 'CANCELLED', reason: 'corrida cancelada antes de este paso', evidence: { method: step.method, path: step.path } });
        continue;
      }
      const blockedBy = dependenciesOf(steps, index).find((key) => !PASSING_DEPENDENCY.includes(results.get(key)?.status ?? 'PENDING'));
      if (blockedBy) {
        const cause = results.get(blockedBy);
        await close({
          ...base,
          status: 'SKIPPED_DEPENDENCY',
          reason: `depende de ${blockedBy}`,
          rootCauseStepKey: cause?.rootCauseStepKey ?? blockedBy,
          evidence: { method: step.method, path: step.path },
        });
        continue;
      }
      if (step.applicability && !evaluateCondition(step.applicability.when, input.scope)) {
        await close({ ...base, status: 'NOT_APPLICABLE', reason: step.applicability.reason, evidence: { method: step.method, path: step.path } });
        continue;
      }
      await close(await this.execute(step, operationId, base, input));
    }
    return steps.map((step) => results.get(step.stepKey) as StepRecord);
  }

  private async execute(
    step: RecipeStep,
    operationId: string,
    base: Pick<StepRecord, 'stepKey' | 'workflowStepCode' | 'visitIndex' | 'logicalOperationId' | 'failures' | 'attempts'>,
    input: PersonaExecutionInput,
  ): Promise<Omit<StepRecord, 'startedAt' | 'finishedAt'>> {
    const scope = input.scope;
    let path: string;
    let body: unknown;
    let query: Record<string, string> | undefined;
    try {
      path = interpolate(step.path, scope);
      body = resolveBinding(step.body, scope);
      query = step.query ? Object.fromEntries(Object.entries(step.query).map(([key, value]) => [key, String(resolveBinding(value, scope))])) : undefined;
    } catch (error) {
      if (!(error instanceof BindingUnresolvedError)) throw error;
      // Antes del envío: no se gasta una petición en un cuerpo que ya sabemos incompleto.
      return { ...base, status: 'FAILED', reason: error.message, failures: [{ code: 'BINDING_UNRESOLVED', message: error.message, path: error.path }], evidence: { method: step.method, path: step.path } };
    }
    const evidence: StepRecord['evidence'] = { method: step.method, path, requestBody: body === undefined ? undefined : summarize(body) };

    const headers: Record<string, string> = {};
    if (step.actor !== 'anonymous') {
      const token = readOptional(scope, `session.${step.actor}.accessToken`);
      if (typeof token !== 'string' || token === '') {
        return { ...base, status: 'FAILED', reason: `no hay sesión de ${step.actor} para esta persona`, failures: [{ code: 'BINDING_UNRESOLVED', message: `session.${step.actor}.accessToken` }], evidence };
      }
      headers.authorization = `Bearer ${token}`;
    }
    if (step.idempotency === 'per_operation') headers['x-idempotency-key'] = idempotencyKeyFor(operationId);
    const expected = selectExpectation(step.expect, step.branches, scope);

    const attempts: AttemptRecord[] = [];
    const maxTransportAttempts = step.method === 'GET' || step.idempotency === 'per_operation' ? Math.max(1, step.retry?.maxAttempts ?? 1) : 1;
    let verdict: StepVerdict | null = null;
    let lastBody: unknown = null;
    const deadline = step.poll ? Date.now() + step.poll.deadlineMs : 0;

    for (;;) {
      let admissionLagMs = 0;
      if (step.rateLimit) admissionLagMs = (await this.deps.admission.admit(step.rateLimit.bucket, step.rateLimit.perMinute, input.signal)).admissionLagMs;
      const slot = await this.deps.budget.acquire();
      if (!slot.ok) {
        const status: QaStepStatus = slot.reason === 'CANCELLED' ? 'CANCELLED' : 'INDETERMINATE';
        return { ...base, status, attempts, reason: slot.reason, evidence };
      }
      const attempt = attempts.length + 1;
      let response;
      try {
        response = await this.deps.transport.send({
          method: step.method,
          path,
          query,
          headers: { ...headers, ...this.deps.credential.headerFor({ personaKey: input.personaKey, logicalOperationId: operationId, attempt }) },
          body,
          timeoutMs: step.timeoutMs ?? input.defaultTimeoutMs,
          signal: input.signal,
        });
      } finally {
        slot.release();
      }
      lastBody = response.status === null ? null : response.body;
      attempts.push({
        attempt,
        status: response.status,
        latencyMs: Math.round(response.latencyMs),
        admissionLagMs: Math.round(admissionLagMs),
        transportError: response.status === null ? response.error : undefined,
        requestId: response.status === null ? undefined : (readOptional({ b: response.body }, 'b.requestId') as string | undefined),
        errorCode: response.status === null ? undefined : errorCodeOf(response.body),
      });

      // 429 en un paso limitado: la ventana del backend es por IP, no por proceso. Misma intención,
      // misma clave; la espera se contabiliza como admisión, no como latencia.
      if (response.status === 429 && step.rateLimit && attempts.filter((entry) => entry.status === 429).length <= MAX_RATE_LIMIT_RETRIES) {
        await this.deps.sleep(RATE_LIMIT_WAIT_MS, input.signal);
        if (!input.signal.aborted) continue;
      }
      if (response.status === null && attempts.length < maxTransportAttempts && !input.signal.aborted) continue;

      verdict = evaluateQaStep({
        expected,
        response: response.status === null ? { status: null, transportError: response.error } : { status: response.status, body: response.body },
        scope,
      });
      if (step.poll && response.status !== null && Date.now() < deadline && !input.signal.aborted) {
        const done = evaluateQaStep({ expected: { status: expected.status, assertions: step.poll.until }, response: { status: response.status, body: response.body }, scope });
        if (done.status !== 'PASSED') {
          await this.deps.sleep(step.poll.intervalMs, input.signal);
          continue;
        }
      }
      break;
    }

    evidence.responseSummary = summarize(lastBody);
    if (verdict.status !== 'PASSED') {
      return { ...base, status: verdict.status, branch: verdict.branch, failures: verdict.failures, reason: verdict.failures[0]?.message, attempts, evidence };
    }
    const extracted: Record<string, unknown> = {};
    for (const extraction of step.extract ?? []) {
      const value = readOptional({ ...scope, response: lastBody }, extraction.from);
      if (value === undefined) {
        if (!extraction.required) continue;
        return {
          ...base,
          status: 'FAILED',
          branch: verdict.branch,
          reason: `la respuesta no trae ${extraction.from}, que los pasos siguientes necesitan`,
          failures: [{ code: 'ASSERTION_EXISTS_FAILED', message: `falta ${extraction.from}` }],
          attempts,
          evidence,
        };
      }
      setPath(scope as Record<string, unknown>, extraction.to, value);
      // Los tokens se extraen a la sesión pero NUNCA a la evidencia.
      if (!extraction.to.startsWith('session.')) extracted[extraction.to] = value;
    }
    evidence.extracted = extracted;
    return { ...base, status: 'PASSED', branch: verdict.branch, attempts, evidence };
  }
}
