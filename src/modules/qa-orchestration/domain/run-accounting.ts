/**
 * @file Utilidad pura del dominio: contabilidad y veredicto de una corrida QA.
 * @business Esta pieza impide que los conteos mientan: omitidos, indeterminados y retries no se
 *   convierten en aprobados, y un denominador cero es «sin muestras», no 100 %.
 * @system identidad de operación lógica, contadores y veredicto a partir de estados persistidos.
 */
import { createHash } from 'node:crypto';
import type { QaPersonaStatus, QaRunCounters, QaRunVerdict, QaStepStatus } from './qa-run.types.js';

/**
 * `logicalOperationId = hash(tenant, run, persona, step, visitIndex)`.
 *
 * El intento NO entra: un reintento de transporte es la misma intención y tiene que llevar la misma
 * clave de idempotencia. Una acción nueva legítima incrementa `visitIndex`; una corrida nueva trae
 * otro `runId`.
 */
export function logicalOperationId(input: { tenantId: string; runId: string; personaKey: string; stepKey: string; visitIndex: number }): string {
  return createHash('sha256')
    .update([input.tenantId, input.runId, input.personaKey, input.stepKey, String(input.visitIndex)].join('|'))
    .digest('hex')
    .slice(0, 32);
}

/** Clave de idempotencia derivada de la operación lógica. Legible en logs sin revelar nada. */
export function idempotencyKeyFor(operationId: string): string {
  return `qa-${operationId}`;
}

type PersonaTally = Record<QaPersonaStatus, number>;
type StepTally = Record<QaStepStatus, number>;

export function emptyPersonaTally(): PersonaTally {
  return { PENDING: 0, RUNNING: 0, PASSED: 0, FAILED: 0, BLOCKED: 0, INDETERMINATE: 0, CANCELLED: 0 };
}

export function emptyStepTally(): StepTally {
  return { PENDING: 0, RUNNING: 0, PASSED: 0, FAILED: 0, SKIPPED_DEPENDENCY: 0, NOT_APPLICABLE: 0, INDETERMINATE: 0, CANCELLED: 0 };
}

/** `null` cuando no hay muestras: nunca se publica un 100 % sobre cero pasos evaluados. */
export function passRate(passed: number, failed: number): number | null {
  const denominator = passed + failed;
  return denominator === 0 ? null : passed / denominator;
}

export function countersFrom(input: { personas: PersonaTally; steps: StepTally; requestsIssued: number; personsRequested: number }): QaRunCounters {
  const { personas, steps } = input;
  return {
    personsRequested: input.personsRequested,
    personsPending: personas.PENDING,
    personsRunning: personas.RUNNING,
    personsPassed: personas.PASSED,
    personsFailed: personas.FAILED,
    personsBlocked: personas.BLOCKED,
    personsIndeterminate: personas.INDETERMINATE,
    personsCancelled: personas.CANCELLED,
    stepsPassed: steps.PASSED,
    stepsFailed: steps.FAILED,
    stepsIndeterminate: steps.INDETERMINATE,
    stepsSkipped: steps.SKIPPED_DEPENDENCY,
    stepsNotApplicable: steps.NOT_APPLICABLE,
    requestsIssued: input.requestsIssued,
    passRate: passRate(steps.PASSED, steps.FAILED),
  };
}

/** Invariante: pendientes + activas + terminales = solicitadas. Si no cuadra, el conteo miente. */
export function personasBalance(counters: QaRunCounters): boolean {
  const sum =
    counters.personsPending +
    counters.personsRunning +
    counters.personsPassed +
    counters.personsFailed +
    counters.personsBlocked +
    counters.personsIndeterminate +
    counters.personsCancelled;
  return sum === counters.personsRequested;
}

/**
 * Veredicto de una corrida TERMINADA.
 *
 * - Una persona fallida ⇒ FAILED, aunque las demás pasaran.
 * - Indeterminadas, bloqueadas o canceladas sin fallos ⇒ INCONCLUSIVE: no se puede afirmar que pasó.
 * - Cero personas evaluadas ⇒ INCONCLUSIVE.
 * - Evidencia externa exigida y ausente ⇒ INCONCLUSIVE, aunque todo lo demás esté verde.
 */
export function runVerdict(counters: QaRunCounters, evidence: { externalEvidenceMissing: boolean }): QaRunVerdict {
  if (counters.personsFailed > 0) return 'FAILED';
  if (counters.personsPassed === 0) return 'INCONCLUSIVE';
  if (counters.personsIndeterminate + counters.personsBlocked + counters.personsCancelled + counters.personsPending + counters.personsRunning > 0) {
    return 'INCONCLUSIVE';
  }
  if (evidence.externalEvidenceMissing) return 'INCONCLUSIVE';
  return 'PASSED';
}

/**
 * Estado terminal de una persona a partir de sus pasos.
 *
 * PASSED exige que TODO paso obligatorio aplicable haya pasado. Un NOT_APPLICABLE con motivo es
 * legítimo; un SKIPPED_DEPENDENCY implica que algo antes falló o quedó indeterminado.
 */
export function personaOutcome(steps: QaStepStatus[]): QaPersonaStatus {
  if (steps.includes('FAILED')) return 'FAILED';
  if (steps.includes('INDETERMINATE')) return 'INDETERMINATE';
  if (steps.includes('CANCELLED')) return 'CANCELLED';
  if (steps.includes('SKIPPED_DEPENDENCY') || steps.includes('PENDING') || steps.includes('RUNNING')) return 'BLOCKED';
  if (!steps.includes('PASSED')) return 'BLOCKED';
  return 'PASSED';
}
