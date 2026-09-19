/**
 * Carga y aplicación de `config/performance-budget.json`.
 *
 * La regla que define este módulo: **mientras el presupuesto no esté calibrado contra un baseline
 * real, los umbrales de latencia se reportan pero no fallan la corrida.** Un p95 inventado que
 * rompe el build enseña al equipo a ignorar el gate, que es peor que no tenerlo; y un p95 inventado
 * que pasa da una falsa sensación de cumplimiento. Reportar sin bloquear es lo único honesto hasta
 * que alguien mida.
 *
 * Los umbrales de CORRECTITUD (5xx, timeouts, tasa de error) sí bloquean desde el primer día: no
 * dependen de ningún objetivo comercial.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LoadResult } from './load-engine.js';

export type ScenarioShapeConfig = { arrivalRatePerSecond: number; durationSeconds: number; warmupSeconds: number; maxInFlight: number };

export type PerformanceBudget = {
  calibratedFrom: string | null;
  scenarios: Record<string, ScenarioShapeConfig>;
  thresholds: {
    enforced: { maxErrorRatePercent: number; maxServerErrorCount: number; maxTimeoutCount: number; maxHeapGrowthPercentSoak: number };
    provisional: { p95Ms: number; p99Ms: number; minThroughputPerSecond: number };
  };
  scenarioOverrides: Record<string, { maxErrorRatePercent?: number; maxServerErrorCount?: number | null }>;
};

export type BudgetCheck = { name: string; ok: boolean; enforced: boolean; detail: string };

export type BudgetVerdict = { calibrated: boolean; passed: boolean; checks: BudgetCheck[] };

export function loadBudget(projectRoot: string): PerformanceBudget {
  const path = resolve(projectRoot, 'config/performance-budget.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  return {
    calibratedFrom: (raw.calibratedFrom as string | null) ?? null,
    scenarios: raw.scenarios as Record<string, ScenarioShapeConfig>,
    thresholds: raw.thresholds as PerformanceBudget['thresholds'],
    scenarioOverrides: (raw.scenarioOverrides as PerformanceBudget['scenarioOverrides']) ?? {},
  };
}

/** `null` en un override significa "esta comprobación no aplica a este escenario", no "cero". */
function resolveLimit<T>(base: T, override: T | null | undefined): T | null {
  if (override === null) return null;
  return override ?? base;
}

export function evaluateBudget(input: {
  budget: PerformanceBudget;
  scenario: string;
  result: LoadResult;
  heapGrowthPercent: number | null;
}): BudgetVerdict {
  const { budget, scenario, result } = input;
  const override = budget.scenarioOverrides[scenario] ?? {};
  const enforced = budget.thresholds.enforced;
  const provisional = budget.thresholds.provisional;
  const calibrated = budget.calibratedFrom !== null;
  const checks: BudgetCheck[] = [];

  const maxErrorRate = resolveLimit(enforced.maxErrorRatePercent, override.maxErrorRatePercent);
  if (maxErrorRate !== null) {
    checks.push({
      name: 'tasa de error',
      ok: result.errorRatePercent <= maxErrorRate,
      enforced: true,
      detail: `${result.errorRatePercent}% medido, máximo ${maxErrorRate}%`,
    });
  }

  const maxServerErrors = resolveLimit(enforced.maxServerErrorCount, override.maxServerErrorCount);
  if (maxServerErrors === null) {
    checks.push({
      name: 'respuestas 5xx',
      ok: true,
      enforced: false,
      detail: `${result.errors.serverErrors} observadas; el escenario '${scenario}' busca el punto de degradación, así que no se exige cero`,
    });
  } else {
    checks.push({
      name: 'respuestas 5xx',
      ok: result.errors.serverErrors <= maxServerErrors,
      enforced: true,
      detail: `${result.errors.serverErrors} observadas, máximo ${maxServerErrors}`,
    });
  }

  checks.push({
    name: 'timeouts de cliente',
    ok: result.errors.timeouts <= enforced.maxTimeoutCount,
    enforced: true,
    detail: `${result.errors.timeouts} observados, máximo ${enforced.maxTimeoutCount}`,
  });

  // `dropped` no tiene umbral: no es un fallo del backend sino la constatación de que dejó de
  // absorber el ritmo ofrecido. Se reporta siempre para que aparezca en el informe.
  checks.push({
    name: 'peticiones no enviadas por saturación',
    ok: result.dropped === 0,
    enforced: false,
    detail:
      result.dropped === 0
        ? 'ninguna: el backend absorbió el ritmo completo'
        : `${result.dropped} descartadas al alcanzar maxInFlight=${result.shape.maxInFlight}: el backend no absorbe ${result.shape.arrivalRatePerSecond} req/s`,
  });

  if (scenario === 'soak') {
    const growth = input.heapGrowthPercent;
    checks.push(
      growth === null
        ? { name: 'crecimiento de heap', ok: true, enforced: false, detail: 'no medible (/metrics no respondió en ambos extremos)' }
        : {
            name: 'crecimiento de heap',
            ok: growth <= enforced.maxHeapGrowthPercentSoak,
            enforced: true,
            detail: `${growth}% entre inicio y fin, máximo ${enforced.maxHeapGrowthPercentSoak}%`,
          },
    );
  }

  const latencySuffix = calibrated ? '' : ' [provisional: no falla la corrida]';
  checks.push({
    name: 'latencia p95',
    ok: result.overall.p95Ms <= provisional.p95Ms,
    enforced: calibrated,
    detail: `${result.overall.p95Ms}ms medido, presupuesto ${provisional.p95Ms}ms${latencySuffix}`,
  });
  checks.push({
    name: 'latencia p99',
    ok: result.overall.p99Ms <= provisional.p99Ms,
    enforced: calibrated,
    detail: `${result.overall.p99Ms}ms medido, presupuesto ${provisional.p99Ms}ms${latencySuffix}`,
  });

  if (provisional.minThroughputPerSecond > 0) {
    checks.push({
      name: 'throughput mínimo',
      ok: result.throughputPerSecond >= provisional.minThroughputPerSecond,
      enforced: calibrated,
      detail: `${result.throughputPerSecond} req/s medidos, mínimo ${provisional.minThroughputPerSecond}${latencySuffix}`,
    });
  }

  return { calibrated, passed: checks.every((check) => check.ok || !check.enforced), checks };
}
