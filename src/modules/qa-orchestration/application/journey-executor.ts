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
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { logicalOperationId } from '../domain/run-accounting.js';
import type { QaStepStatus } from '../domain/qa-run.types.js';
import { evaluateCondition, type BindingScope } from '../domain/typed-bindings.js';
import { dependenciesOf } from '../domain/recipe-validation.js';
import type { AdmissionPort, BudgetPort, QaCredentialPort, QaTransport, StepRecord, StepSink } from './executor.ports.js';
import { StepRunner, type StepBase, type StepResult } from './step-runner.js';

export type PersonaExecutionInput = {
  tenantId: string;
  runId: string;
  personaKey: string;
  template: JourneyTemplate;
  /** Persona, fixtures y run ya resueltos. `resources`/`session` empiezan vacíos o desde checkpoint. */
  scope: BindingScope & { resources: Record<string, unknown>; session: Record<string, Record<string, unknown>> };
  /** Pasos ya confirmados en un intento anterior del worker: no se repiten. */
  completed?: Map<string, StepRecord>;
  /** Se retoma tras un reinicio: los pasos `replayOnResume` se repiten para recuperar la sesión. */
  resumed?: boolean;
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

type Resume = 'skip' | 'run' | 'indeterminate';

/**
 * Qué hacer con un paso que ya tiene registro de un intento anterior del worker.
 *
 * Un RUNNING es una escritura cuyo resultado no se conoce: sólo se reenvía si es seguro (lectura, o
 * escritura con clave idempotente estable); si no, INDETERMINATE. Un paso `replayOnResume` (el
 * login) se repite al retomar para recuperar la sesión, que no se persiste.
 */
function resumeDecision(step: RecipeStep, previous: StepRecord | undefined, resumed: boolean): Resume {
  if (!previous) return 'run';
  if (step.replayOnResume === true && resumed) return 'run';
  if (previous.status !== 'RUNNING') return 'skip';
  const safe = step.method === 'GET' || step.idempotency === 'per_operation' || step.replayOnResume === true;
  return safe ? 'run' : 'indeterminate';
}

export class JourneyExecutor {
  constructor(private readonly deps: PersonaExecutionDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  /** Estado que el paso tiene ANTES de enviarse: cancelado, omitido por dependencia o no aplicable. */
  private precheck(
    step: RecipeStep,
    index: number,
    results: Map<string, StepRecord>,
    input: PersonaExecutionInput,
    base: StepBase,
  ): StepResult | null {
    const evidence = { method: step.method, path: step.path };
    if (input.signal.aborted) return { ...base, status: 'CANCELLED', reason: 'corrida cancelada antes de este paso', evidence };
    const blockedBy = dependenciesOf(input.template.steps, index).find(
      (key) => !PASSING_DEPENDENCY.includes(results.get(key)?.status ?? 'PENDING'),
    );
    if (blockedBy) {
      const cause = results.get(blockedBy);
      return {
        ...base,
        status: 'SKIPPED_DEPENDENCY',
        reason: `depende de ${blockedBy}`,
        rootCauseStepKey: cause?.rootCauseStepKey ?? blockedBy,
        evidence,
      };
    }
    if (step.applicability && !evaluateCondition(step.applicability.when, input.scope)) {
      return { ...base, status: 'NOT_APPLICABLE', reason: step.applicability.reason, evidence };
    }
    return null;
  }

  /** Recorre la receta completa y devuelve el estado de cada paso, en orden. */
  async run(input: PersonaExecutionInput): Promise<StepRecord[]> {
    const results = new Map<string, StepRecord>(input.completed ?? []);
    const steps = input.template.steps;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const previous = results.get(step.stepKey);
      const decision = resumeDecision(step, previous, input.resumed === true);
      if (decision === 'skip') continue;
      if (decision === 'indeterminate' && previous) {
        const record: StepRecord = {
          ...previous,
          status: 'INDETERMINATE',
          reason: 'el worker se reinició con esta escritura en vuelo; el efecto no se puede confirmar',
        };
        results.set(step.stepKey, record);
        await this.deps.sink.record(record);
        continue;
      }
      const operationId = logicalOperationId({
        tenantId: input.tenantId,
        runId: input.runId,
        personaKey: input.personaKey,
        stepKey: step.stepKey,
        visitIndex: 0,
      });
      const base: StepBase = {
        stepKey: step.stepKey,
        workflowStepCode: step.workflowStepCode,
        visitIndex: 0,
        logicalOperationId: operationId,
        failures: [],
        attempts: [],
      };
      const startedAt = this.now();
      const outcome =
        this.precheck(step, index, results, input, base) ?? (await new StepRunner(this.deps, step, operationId, base, input).run());
      const record: StepRecord = { ...outcome, startedAt, finishedAt: this.now() };
      results.set(step.stepKey, record);
      await this.deps.sink.record(record);
    }
    return steps.map((step) => results.get(step.stepKey) as StepRecord);
  }
}
