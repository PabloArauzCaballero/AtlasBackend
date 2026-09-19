import { describe, expect, it, jest, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { publishTraceIdHeader } from '../../../src/common/observability/trace-id-header.js';
import { TracingService } from '../../../src/common/observability/tracing.service.js';
import { installInMemoryTracing, type TracingHarness } from './support/in-memory-tracing.js';

let harness: TracingHarness;
const tracing = new TracingService();

beforeAll(() => {
  harness = installInMemoryTracing();
});
beforeEach(() => harness.reset());
afterAll(() => harness.shutdown());

function respuesta(headersSent = false) {
  return { headersSent, setHeader: jest.fn() };
}

describe('cabecera x-trace-id', () => {
  it('publica el identificador de la traza en curso', async () => {
    const res = respuesta();
    await tracing.runInSpan('operacion', {}, () => {
      expect(publishTraceIdHeader(res)).toBe(true);
    });
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', harness.spanNamed('operacion')!.spanContext().traceId);
  });

  it('SIN traza no emite nada: una cabecera vacía mandaría a buscar algo que no existe', () => {
    const res = respuesta();
    expect(publishTraceIdHeader(res)).toBe(false);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('no escribe sobre una respuesta ya enviada', async () => {
    const res = respuesta(true);
    await tracing.runInSpan('operacion', {}, () => {
      expect(publishTraceIdHeader(res)).toBe(false);
    });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('es idempotente: el interceptor y el filtro pueden llamarla los dos', async () => {
    const res = respuesta();
    await tracing.runInSpan('operacion', {}, () => {
      publishTraceIdHeader(res);
      publishTraceIdHeader(res);
    });
    const valores = res.setHeader.mock.calls.map((c) => c[1]);
    expect(new Set(valores).size).toBe(1);
  });
});
