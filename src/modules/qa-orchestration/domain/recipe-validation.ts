/**
 * @file Utilidad pura del dominio: valida el grafo y los bindings de una receta QA.
 * @business Esta pieza bloquea una receta rota ANTES de ejecutarla: una referencia que nadie
 *   produce, un ciclo o un reintento de escritura sin idempotencia no llegan a generar tráfico.
 * @system cada paso sólo puede consumir lo que produce un ANCESTRO en su cadena de dependencias.
 */
import { ASSERTION_KINDS, type Assertion, type JourneyTemplate, type RecipeStep } from './journey-recipe.types.js';
import type { QaBlocker } from './qa-run.types.js';
import { conditionPaths, referencedPaths } from './typed-bindings.js';

/** Campos de persona disponibles para bindings. Mantener en sincronía con el scope del worker. */
export const PERSONA_FIELDS = [
  'ordinal',
  'personaKey',
  'firstName',
  'lastName',
  'birthDate',
  'age',
  'documentNumber',
  'email',
  'phone',
  'city',
  'department',
  'monthlyIncome',
  'requestedAmount',
  'pin',
  'deviceFingerprintHash',
  'archetype',
  'caseCategory',
] as const;

/** Lo que cada fixture deja en `fixtures.*`. */
export const FIXTURE_OUTPUTS: Record<JourneyTemplate['fixtures'][number], string[]> = {
  consents: ['signupConsents'],
  creditProduct: ['creditProductId'],
  internalActor: ['internalActor'],
  merchantActor: ['merchantActor'],
};

const RUN_FIELDS = ['runId', 'namespace', 'seed', 'referenceDate', 'scenarioCode'];

export function dependenciesOf(steps: RecipeStep[], index: number): string[] {
  const step = steps[index];
  if (step.dependsOn) return step.dependsOn;
  return index === 0 ? [] : [steps[index - 1].stepKey];
}

function allAssertions(step: RecipeStep): Assertion[] {
  return [...(step.expect.assertions ?? []), ...(step.branches ?? []).flatMap((branch) => branch.assertions ?? [])];
}

function assertionPaths(assertion: Assertion): string[] {
  if (assertion.kind === 'errorCode') return [];
  const own: string[] = [];
  if ('expected' in assertion) own.push(...referencedPaths(assertion.expected));
  if (assertion.kind === 'sameAs') own.push(assertion.ref);
  return own;
}

function neededPaths(step: RecipeStep): string[] {
  return [
    ...referencedPaths(step.path),
    ...referencedPaths(step.body),
    ...Object.values(step.query ?? {}).flatMap((binding) => referencedPaths(binding)),
    ...(step.applicability ? conditionPaths(step.applicability.when) : []),
    ...(step.branches ?? []).flatMap((branch) => conditionPaths(branch.when)),
    ...allAssertions(step).flatMap(assertionPaths),
  ];
}

function resolvable(path: string, available: Set<string>): boolean {
  const [root, field] = path.split('.');
  if (root === 'persona') return (PERSONA_FIELDS as readonly string[]).includes(field);
  if (root === 'run') return RUN_FIELDS.includes(field);
  if (root === 'response') return true;
  // Condicionar sobre un recurso opcional es legítimo si ALGÚN ancestro lo intenta extraer.
  return available.has(path) || [...available].some((candidate) => path.startsWith(`${candidate}.`));
}

type Graph = { steps: RecipeStep[]; index: Map<string, number>; produces: Map<string, Set<string>>; fixtures: Set<string> };

function ancestorsOf(graph: Graph, position: number, seen = new Set<string>()): Set<string> {
  for (const dependency of dependenciesOf(graph.steps, position)) {
    const at = graph.index.get(dependency);
    if (at === undefined || at >= position || seen.has(dependency)) continue;
    seen.add(dependency);
    ancestorsOf(graph, at, seen);
  }
  return seen;
}

function dependencyBlockers(graph: Graph, step: RecipeStep, position: number): QaBlocker[] {
  return dependenciesOf(graph.steps, position).flatMap((dependency): QaBlocker[] => {
    const at = graph.index.get(dependency);
    if (at === undefined)
      return [{ code: 'GRAPH_INVALID', message: `${step.stepKey} depende de ${dependency}, que no existe`, subject: step.stepKey }];
    if (at >= position)
      return [{ code: 'GRAPH_INVALID', message: `${step.stepKey} depende de ${dependency}, posterior o cíclico`, subject: step.stepKey }];
    return [];
  });
}

function stepShapeBlockers(step: RecipeStep): QaBlocker[] {
  const blockers: QaBlocker[] = [];
  if (step.retry && step.retry.maxAttempts > 1 && step.method !== 'GET' && step.idempotency !== 'per_operation') {
    blockers.push({
      code: 'GRAPH_INVALID',
      message: `${step.stepKey} reintenta una escritura sin idempotencia declarada`,
      subject: step.stepKey,
    });
  }
  for (const assertion of allAssertions(step)) {
    if (!(ASSERTION_KINDS as readonly string[]).includes(assertion.kind)) {
      blockers.push({
        code: 'CONTRACT_MISMATCH',
        message: `${step.stepKey} usa una aserción desconocida: ${assertion.kind}`,
        subject: step.stepKey,
      });
    }
  }
  return blockers;
}

function bindingBlockers(graph: Graph, step: RecipeStep, position: number): QaBlocker[] {
  const available = new Set<string>(graph.fixtures);
  for (const ancestor of ancestorsOf(graph, position)) for (const produced of graph.produces.get(ancestor) ?? []) available.add(produced);
  return neededPaths(step)
    .filter((path) => !resolvable(path, available))
    .map((path) => ({
      code: 'BINDING_UNRESOLVED' as const,
      message: `${step.stepKey} necesita ${path} y ningún paso anterior lo produce`,
      subject: step.stepKey,
    }));
}

/** Valida el grafo y que cada referencia tenga un productor ANTERIOR en su cadena de dependencias. */
export function validateRecipe(template: JourneyTemplate): QaBlocker[] {
  const blockers: QaBlocker[] = [];
  const graph: Graph = {
    steps: template.steps,
    index: new Map(),
    produces: new Map(),
    fixtures: new Set(template.fixtures.flatMap((fixture) => FIXTURE_OUTPUTS[fixture].map((name) => `fixtures.${name}`))),
  };
  template.steps.forEach((step, position) => {
    if (graph.index.has(step.stepKey))
      blockers.push({ code: 'GRAPH_INVALID', message: `stepKey duplicado: ${step.stepKey}`, subject: step.stepKey });
    graph.index.set(step.stepKey, position);
    graph.produces.set(step.stepKey, new Set((step.extract ?? []).map((extraction) => extraction.to)));
  });
  template.steps.forEach((step, position) => {
    blockers.push(...dependencyBlockers(graph, step, position), ...stepShapeBlockers(step), ...bindingBlockers(graph, step, position));
  });
  return blockers;
}
