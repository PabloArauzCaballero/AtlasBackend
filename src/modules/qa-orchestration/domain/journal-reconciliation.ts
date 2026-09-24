/**
 * @file Utilidad pura del dominio: cruza lo que el backend dijo con lo que el mock VIO.
 * @business Esta pieza impide certificar integración sin tráfico real: sin la entrada del journal
 *   que corresponde, un paso «verde» contra el proveedor no cuenta como evidencia.
 * @system correlación por persona + operación lógica; cada expectativa declara 0, ≥1 o cualquiera.
 *
 * No compara «N consultas = N entradas»: caché, idempotencia y reintentos cambian la cardinalidad.
 * Cada operación declara qué esperaba y se juzga por separado.
 */
import type { JourneyTemplate } from './journey-recipe.types.js';

export type JournalEntryLite = { type?: string; provider?: string; personaKey?: string | null; logicalOperationId?: string | null };

export type ExecutedProviderStep = { personaKey: string; stepKey: string; logicalOperationId: string; status: string };

export type ProviderViolation = {
  personaKey: string;
  stepKey: string;
  provider: string;
  expected: string;
  observed: number;
  message: string;
};

export type ReconciliationResult = {
  /** `true` sólo si el journal estaba completo y todas las expectativas se cumplieron. */
  mockConfirmed: boolean | null;
  providerCalls: number;
  unattributedCalls: number;
  violations: ProviderViolation[];
  detail: string;
};

type Expectations = Map<string, NonNullable<JourneyTemplate['steps'][number]['providers']>>;

const CALL_TYPES = new Set(['responded', 'rejected', 'aborted']);

/** Llamadas por `persona|operación|proveedor`; las que no traen persona u operación no se atribuyen. */
function countCalls(entries: JournalEntryLite[]): { counted: Map<string, number>; calls: number; unattributed: number } {
  const counted = new Map<string, number>();
  let calls = 0;
  let unattributed = 0;
  for (const entry of entries) {
    if (!CALL_TYPES.has(entry.type ?? '')) continue;
    calls += 1;
    if (!entry.personaKey || !entry.logicalOperationId) {
      unattributed += 1;
      continue;
    }
    const key = `${entry.personaKey}|${entry.logicalOperationId}|${String(entry.provider ?? '').toUpperCase()}`;
    counted.set(key, (counted.get(key) ?? 0) + 1);
  }
  return { counted, calls, unattributed };
}

function violationFor(step: ExecutedProviderStep, provider: string, expectCall: string, observed: number): ProviderViolation | null {
  if (expectCall === 'none' && observed > 0) {
    return {
      ...step,
      provider,
      expected: 'none',
      observed,
      message: `${step.stepKey} no debía llamar a ${provider} y el mock registró ${observed} llamada(s)`,
    };
  }
  if (expectCall === 'required' && observed === 0) {
    return {
      ...step,
      provider,
      expected: 'required',
      observed,
      message: `${step.stepKey} debía llamar a ${provider} y el mock no vio ninguna llamada`,
    };
  }
  return null;
}

function findViolations(executed: ExecutedProviderStep[], expectations: Expectations, counted: Map<string, number>): ProviderViolation[] {
  const violations: ProviderViolation[] = [];
  for (const step of executed) {
    // Un paso que no se ejecutó (omitido, no aplicable) no puede exigir ni prohibir llamadas.
    if (!['PASSED', 'FAILED'].includes(step.status)) continue;
    for (const expectation of expectations.get(step.stepKey) ?? []) {
      const observed = counted.get(`${step.personaKey}|${step.logicalOperationId}|${expectation.provider.toUpperCase()}`) ?? 0;
      const violation = violationFor(step, expectation.provider, expectation.expectCall, observed);
      if (violation) violations.push(violation);
    }
  }
  return violations;
}

function describe(complete: boolean, violations: number, calls: number, unattributed: number): string {
  if (!complete) return 'El journal del mock descartó entradas por retención: la evidencia está incompleta y no certifica la corrida.';
  if (violations > 0) return `${violations} expectativa(s) de proveedor incumplida(s).`;
  if (calls === 0) return 'El mock no registró ninguna llamada de esta corrida: el tráfico externo no salió por la red.';
  return `${calls} llamada(s) al mock correlacionadas con su persona y operación${unattributed > 0 ? `; ${unattributed} sin atribuir` : ''}.`;
}

export function reconcileJournal(input: {
  template: JourneyTemplate;
  executed: ExecutedProviderStep[];
  journal: { entries: JournalEntryLite[]; complete: boolean } | null;
  namespaceOpened: boolean;
}): ReconciliationResult {
  const expectations: Expectations = new Map(
    input.template.steps.filter((step) => (step.providers ?? []).length > 0).map((step) => [step.stepKey, step.providers ?? []]),
  );
  if (expectations.size === 0) {
    return {
      mockConfirmed: null,
      providerCalls: 0,
      unattributedCalls: 0,
      violations: [],
      detail: 'Este recorrido no llama a proveedores externos.',
    };
  }
  if (!input.namespaceOpened || !input.journal) {
    return {
      mockConfirmed: false,
      providerCalls: 0,
      unattributedCalls: 0,
      violations: [],
      detail: 'Sin namespace propio o sin journal del mock: no hay evidencia externa que cruzar.',
    };
  }
  const { counted, calls, unattributed } = countCalls(input.journal.entries);
  const violations = findViolations(input.executed, expectations, counted);
  const complete = input.journal.complete;
  return {
    mockConfirmed: complete && violations.length === 0 && calls > 0,
    providerCalls: calls,
    unattributedCalls: unattributed,
    violations,
    detail: describe(complete, violations.length, calls, unattributed),
  };
}
