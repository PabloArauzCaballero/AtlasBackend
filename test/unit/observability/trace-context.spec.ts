import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { TraceContextService, readActiveTraceId, readActiveTraceIds } from '../../../src/common/observability/trace-context.service.js';
import { TracingService } from '../../../src/common/observability/tracing.service.js';
import { installInMemoryTracing, type TracingHarness } from './support/in-memory-tracing.js';

let harness: TracingHarness;
const tracing = new TracingService();
const contexto = new TraceContextService();

beforeAll(() => {
  harness = installInMemoryTracing();
});
beforeEach(() => harness.reset());
afterAll(() => harness.shutdown());

describe('lectura del contexto de traza', () => {
  it('devuelve los identificadores del span en curso', async () => {
    let leidos = readActiveTraceIds();
    await tracing.runInSpan('operacion', {}, () => {
      leidos = readActiveTraceIds();
    });
    const span = harness.spanNamed('operacion')!;
    expect(leidos.traceId).toBe(span.spanContext().traceId);
    expect(leidos.spanId).toBe(span.spanContext().spanId);
    expect(leidos.traceFlags).toBe(span.spanContext().traceFlags);
  });

  it('el identificador es el formato de 32 hex que Jaeger sabe buscar', async () => {
    let id: string | undefined;
    await tracing.runInSpan('operacion', {}, () => {
      id = readActiveTraceId();
    });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('SIN span activo devuelve vacío: nunca un identificador inventado', () => {
    expect(readActiveTraceIds()).toEqual({ traceId: undefined, spanId: undefined, traceFlags: undefined });
    expect(readActiveTraceId()).toBeUndefined();
  });

  it('cada span hijo tiene su propio span_id bajo el mismo trace_id', async () => {
    const vistos: Array<{ traceId?: string; spanId?: string }> = [];
    await tracing.runInSpan('padre', {}, async () => {
      vistos.push(readActiveTraceIds());
      await tracing.runInSpan('hijo', {}, () => {
        vistos.push(readActiveTraceIds());
      });
    });
    expect(vistos[0]?.traceId).toBe(vistos[1]?.traceId);
    expect(vistos[0]?.spanId).not.toBe(vistos[1]?.spanId);
  });

  it('el servicio inyectable expone lo mismo que las funciones libres', async () => {
    await tracing.runInSpan('operacion', {}, () => {
      expect(contexto.getActiveTraceId()).toBe(readActiveTraceId());
      expect(contexto.getActiveSpanId()).toBe(readActiveTraceIds().spanId);
      expect(contexto.getActiveIds()).toEqual(readActiveTraceIds());
    });
  });
});
