/**
 * @file Utilidad de aplicación: da forma a las respuestas de lectura del laboratorio QA.
 * @business Esta pieza resume plantillas y cuenta pasos por estado sin que un omitido sume como
 *   aprobado.
 * @system funciones puras usadas por `QaRunReadService`.
 */
import { endpointKey } from '../catalog/journey-catalog.js';
import type { JourneyTemplate } from '../domain/journey-recipe.types.js';
import { emptyStepTally } from '../domain/run-accounting.js';
import type { QaStepStatus } from '../domain/qa-run.types.js';

export function summary(template: JourneyTemplate) {
  return {
    code: template.code,
    version: template.version,
    name: template.name,
    description: template.description,
    workflowCode: template.workflowCode,
    workflowVersion: template.workflowVersion,
    actors: template.actors,
    scenarios: template.scenarios,
    defaultScenario: template.defaultScenario,
    datasetModes: template.datasetModes,
    expectedTerminal: template.expectedTerminal,
    status: template.status,
    blockedReasons: template.blockedReasons ?? [],
    stepCount: template.steps.length,
    providers: [...new Set(template.steps.flatMap((step) => (step.providers ?? []).map((provider) => provider.provider)))].sort(),
    coveredStepCodes: [...new Set(template.steps.map((step) => step.workflowStepCode).filter((code): code is string => Boolean(code)))],
  };
}

type StepCounts = {
  stepKey: string;
  workflowStepCode: string | null;
  /** Endpoint normalizado: el árbol de cualquier flujo pinta los conteos en el nodo que lo llama. */
  endpoint: string | null;
  passed: number;
  failed: number;
  skipped: number;
  notApplicable: number;
  indeterminate: number;
  cancelled: number;
};

const COUNT_FIELD: Partial<Record<QaStepStatus, keyof Omit<StepCounts, 'stepKey' | 'workflowStepCode' | 'endpoint'>>> = {
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED_DEPENDENCY: 'skipped',
  NOT_APPLICABLE: 'notApplicable',
  INDETERMINATE: 'indeterminate',
  CANCELLED: 'cancelled',
};

export function tallySteps(
  rows: Array<{ step_key: string; workflow_step_code: string | null; status: string; count: string }>,
  template: JourneyTemplate | undefined,
) {
  const steps = emptyStepTally();
  const byStep = new Map<string, StepCounts>();
  for (const entry of rows) {
    const count = Number(entry.count);
    steps[entry.status as QaStepStatus] += count;
    const recipe = template?.steps.find((step) => step.stepKey === entry.step_key);
    const bucket = byStep.get(entry.step_key) ?? {
      stepKey: entry.step_key,
      workflowStepCode: entry.workflow_step_code,
      endpoint: recipe ? endpointKey(recipe.method, recipe.path) : null,
      passed: 0,
      failed: 0,
      skipped: 0,
      notApplicable: 0,
      indeterminate: 0,
      cancelled: 0,
    };
    const field = COUNT_FIELD[entry.status as QaStepStatus];
    if (field) bucket[field] += count;
    byStep.set(entry.step_key, bucket);
  }
  return { steps, byStep };
}
