import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { SpanKind } from '@opentelemetry/api';
import { MessagingTraceService } from '../../../src/common/observability/messaging-trace.service.js';
import { TracingService } from '../../../src/common/observability/tracing.service.js';
import { installInMemoryTracing, type TracingHarness } from './support/in-memory-tracing.js';

let harness: TracingHarness;
const tracing = new TracingService();
const messaging = new MessagingTraceService(tracing);

beforeAll(() => {
  harness = installInMemoryTracing();
});
beforeEach(() => harness.reset());
afterAll(() => harness.shutdown());

describe('propagación entre procesos', () => {
  it('inyecta traceparent con el trace_id del span activo', async () => {
    let portador: Record<string, string> = {};
    await tracing.runInSpan('publica', {}, () => {
      portador = messaging.inject();
    });
    const traceId = harness.spanNamed('publica')!.spanContext().traceId;
    expect(portador.traceparent).toBeDefined();
    expect(portador.traceparent).toContain(traceId);
  });

  it('sin traza activa el portador sale VACÍO: no se inventa un contexto', () => {
    expect(messaging.inject()).toEqual({});
  });

  it('withCarrier conserva la metadata existente y no toca el objeto recibido', async () => {
    const original = Object.freeze({ origen: 'api' });
    let resultado: Record<string, unknown> | null = null;
    await tracing.runInSpan('publica', {}, () => {
      resultado = messaging.withCarrier(original);
    });
    expect(resultado).toMatchObject({ origen: 'api' });
    expect((resultado as unknown as Record<string, unknown>).otel).toHaveProperty('traceparent');
    expect(original).toEqual({ origen: 'api' });
  });

  it('sin traza activa withCarrier no añade la clave', () => {
    expect(messaging.withCarrier({ origen: 'api' })).toEqual({ origen: 'api' });
  });

  it('productor y consumidor comparten trace_id aunque estén en procesos distintos', async () => {
    let metadata: Record<string, unknown> | null = null;
    await messaging.runAsProducer('outbox.publish', {}, () => {
      metadata = messaging.withCarrier({});
    });
    const productor = harness.spanNamed('outbox.publish')!;

    // Segundo "proceso": ya no hay contexto activo, sólo la fila persistida.
    await messaging.runAsConsumer('outbox.dispatch', metadata, {}, () => undefined);
    const consumidor = harness.spanNamed('outbox.dispatch')!;

    expect(consumidor.spanContext().traceId).toBe(productor.spanContext().traceId);
    expect(consumidor.spanContext().spanId).not.toBe(productor.spanContext().spanId);
    expect(consumidor.parentSpanContext?.spanId).toBe(productor.spanContext().spanId);
    expect(productor.kind).toBe(SpanKind.PRODUCER);
    expect(consumidor.kind).toBe(SpanKind.CONSUMER);
  });

  it.each([
    ['una fila antigua sin portador', null],
    ['metadata sin la clave', { origen: 'legacy' }],
    ['la clave con un valor que no es un mapa', { otel: 'traceparent' }],
    ['la clave con un array', { otel: ['x'] }],
    ['valores que no son cadenas', { otel: { traceparent: 42 } }],
    ['un traceparent con basura', { otel: { traceparent: 'no-es-w3c' } }],
  ])('%s: el consumidor abre su propia traza y NO rechaza el trabajo', async (_caso, metadata) => {
    let ejecutado = false;
    await messaging.runAsConsumer('outbox.dispatch', metadata, {}, () => {
      ejecutado = true;
    });
    expect(ejecutado).toBe(true);
    const consumidor = harness.spanNamed('outbox.dispatch')!;
    expect(consumidor.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(consumidor.parentSpanContext).toBeUndefined();
  });

  it('acepta el portador plano, sin envolver', async () => {
    let portador: Record<string, string> = {};
    await tracing.runInSpan('publica', {}, () => {
      portador = messaging.inject();
    });
    const traceId = harness.spanNamed('publica')!.spanContext().traceId;
    await messaging.runAsConsumer('outbox.dispatch', portador, {}, () => undefined);
    expect(harness.spanNamed('outbox.dispatch')!.spanContext().traceId).toBe(traceId);
  });

  it('un fallo del consumidor marca su span y relanza', async () => {
    const error = Object.assign(new Error('x'), { code: 'CONSUMER_ERROR' });
    await expect(messaging.runAsConsumer('outbox.dispatch', null, {}, () => Promise.reject(error))).rejects.toBe(error);
    expect(harness.spanNamed('outbox.dispatch')!.status.message).toBe('CONSUMER_ERROR');
  });
});
