import { describe, expect, it } from '@jest/globals';
import { getCorrelationId, getTraceId, runWithRequestContext } from '../../../../src/common/logging/request-context.js';

/**
 * `request-context` propaga el correlationId del request en curso vía AsyncLocalStorage, para que
 * cualquier logger lo incluya sin pasarlo a mano (hallazgo O-A1 de la auditoría 2026-07-21).
 */
describe('request-context (AsyncLocalStorage)', () => {
  it('getCorrelationId devuelve el id dentro del contexto', () => {
    const seen = runWithRequestContext({ correlationId: 'corr-123' }, () => getCorrelationId());
    expect(seen).toBe('corr-123');
  });

  it('getCorrelationId es undefined FUERA de un contexto (arranque, jobs, tests)', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('el contexto se propaga a trabajo async descendiente', async () => {
    const seen = await runWithRequestContext({ correlationId: 'corr-async' }, async () => {
      await Promise.resolve();
      return getCorrelationId();
    });
    expect(seen).toBe('corr-async');
  });

  it('contextos anidados no se filtran entre sí', () => {
    const outer = runWithRequestContext({ correlationId: 'outer' }, () => {
      const inner = runWithRequestContext({ correlationId: 'inner' }, () => getCorrelationId());
      return { inner, backToOuter: getCorrelationId() };
    });
    expect(outer.inner).toBe('inner');
    expect(outer.backToOuter).toBe('outer');
  });

  it('getTraceId es undefined cuando no hay span OTel activo', () => {
    // Sin tracing habilitado en los tests, no hay span → sin traceId (nunca lanza).
    expect(getTraceId()).toBeUndefined();
  });
});
