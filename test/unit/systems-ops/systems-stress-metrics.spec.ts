/**
 * @file Un percentil sin muestras no es un percentil, y un dry-run no es un PASS.
 * @business Diez peticiones no sostienen un p99; un denominador que no cuadra invalida la tasa que se
 *   calcula sobre él; y una corrida sin datos suficientes queda INCONCLUSIVE, no aprobada.
 * @system `summarizeLatencies`, `checkConservation` y `evaluateGates`, todas puras.
 */
import { describe, expect, it } from '@jest/globals';
import {
  checkConservation,
  evaluateGates,
  MIN_SAMPLES_FOR_PERCENTILES,
  summarizeLatencies,
  type RunCounters,
} from '../../../src/modules/systems-ops/systems-stress-metrics.util.js';

const counters = (overrides: Partial<RunCounters> = {}): RunCounters => ({
  scheduled: 100,
  admitted: 100,
  dropped: 0,
  responded: 100,
  succeeded: 100,
  failedByStatus: 0,
  transportErrors: 0,
  ...overrides,
});

const muestras = (count: number, value = 10): number[] => Array.from({ length: count }, () => value);

describe('resumen de latencias', () => {
  it('sin muestras no inventa números', () => {
    const resumen = summarizeLatencies([]);
    expect(resumen).toMatchObject({ count: 0, min: null, p50: null, p95: null, p99: null, max: null, insufficientSamples: true });
  });

  it('marca la muestra insuficiente en vez de publicar un p99 convincente', () => {
    const resumen = summarizeLatencies(muestras(MIN_SAMPLES_FOR_PERCENTILES - 1));
    expect(resumen.insufficientSamples).toBe(true);
    // El número se calcula igual —está ahí para diagnosticar—, pero va etiquetado.
    expect(resumen.p95).not.toBeNull();
  });

  it('con muestras suficientes deja de marcarla', () => {
    expect(summarizeLatencies(muestras(MIN_SAMPLES_FOR_PERCENTILES)).insufficientSamples).toBe(false);
  });

  it('los percentiles son valores OBSERVADOS, no interpolados', () => {
    const resumen = summarizeLatencies([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(resumen.p50).toBe(5);
    expect(resumen.p95).toBe(100);
    expect(resumen.max).toBe(100);
    expect(resumen.min).toBe(1);
  });

  it('no depende del orden de llegada', () => {
    expect(summarizeLatencies([9, 1, 5, 3, 7]).p50).toBe(summarizeLatencies([1, 3, 5, 7, 9]).p50);
  });
});

describe('conservación de llegadas', () => {
  it('scheduled = admitted + dropped', () => {
    expect(checkConservation(counters({ scheduled: 100, admitted: 90, dropped: 10 })).ok).toBe(true);
  });

  it('si faltan llegadas por explicar, lo dice', () => {
    const resultado = checkConservation(counters({ scheduled: 100, admitted: 90, dropped: 0 }));
    expect(resultado.ok).toBe(false);
    expect(resultado.detail).toContain('faltan 10');
  });
});

describe('evaluación de umbrales', () => {
  const base = { maxErrorRate: 0.05, maxP95Ms: 500, conservation: { ok: true, detail: '' }, dryRun: false };

  it('un dry-run nunca es PASS: validar un plan no es haberlo ejecutado', () => {
    const resultado = evaluateGates({ ...base, dryRun: true, counters: counters(), latency: summarizeLatencies(muestras(100)) });
    expect(resultado.verdict).toBe('NOT_EVALUATED');
    expect(resultado.gates).toHaveLength(0);
  });

  it('dentro de los umbrales y con muestras suficientes: PASS', () => {
    const resultado = evaluateGates({ ...base, counters: counters(), latency: summarizeLatencies(muestras(100, 120)) });
    expect(resultado.verdict).toBe('PASS');
  });

  it('un p95 por encima del umbral: FAIL', () => {
    const resultado = evaluateGates({ ...base, counters: counters(), latency: summarizeLatencies(muestras(100, 900)) });
    expect(resultado.verdict).toBe('FAIL');
    expect(resultado.gates.find((gate) => gate.name === 'latency_p95_ms')?.passed).toBe(false);
  });

  it('los errores de transporte cuentan en la tasa de error: no se borran del gráfico', () => {
    const resultado = evaluateGates({
      ...base,
      counters: counters({ responded: 50, succeeded: 50, transportErrors: 50, admitted: 100 }),
      latency: summarizeLatencies(muestras(50, 100)),
    });
    // 50 de 100 intentos fallaron por transporte: 50 %, muy por encima del 5 %.
    expect(resultado.gates.find((gate) => gate.name === 'error_rate')?.observed).toBeCloseTo(0.5);
    expect(resultado.verdict).toBe('FAIL');
  });

  it('muestra insuficiente: INCONCLUSIVE, no PASS', () => {
    const resultado = evaluateGates({ ...base, counters: counters({ responded: 5 }), latency: summarizeLatencies(muestras(5, 10)) });
    expect(resultado.verdict).toBe('INCONCLUSIVE');
    expect(resultado.gates.find((gate) => gate.name === 'latency_p95_ms')?.detail).toContain('Muestra insuficiente');
  });

  it('sin un solo intento HTTP no hay tasa de error: null, no cero', () => {
    const vacio = counters({ scheduled: 0, admitted: 0, responded: 0, succeeded: 0 });
    const resultado = evaluateGates({ ...base, counters: vacio, latency: summarizeLatencies([]) });
    expect(resultado.gates.find((gate) => gate.name === 'error_rate')?.observed).toBeNull();
    expect(resultado.verdict).toBe('INCONCLUSIVE');
  });

  it('un denominador que no cuadra invalida la corrida entera', () => {
    const resultado = evaluateGates({
      ...base,
      conservation: { ok: false, detail: 'faltan 10' },
      counters: counters(),
      latency: summarizeLatencies(muestras(100, 100)),
    });
    // Los umbrales por sí solos aprobarían; la tasa se calcula sobre un denominador perdido.
    expect(resultado.verdict).toBe('INCONCLUSIVE');
  });

  it('un fallo de umbral manda sobre un dato ausente: FAIL antes que INCONCLUSIVE', () => {
    const resultado = evaluateGates({
      ...base,
      counters: counters({ responded: 5, succeeded: 0, failedByStatus: 5 }),
      latency: summarizeLatencies(muestras(5, 10)),
    });
    // La tasa de error es medible (100 %) aunque el p95 no lo sea: un fallo comprobado no se diluye
    // en un "no se sabe".
    expect(resultado.verdict).toBe('FAIL');
  });
});
