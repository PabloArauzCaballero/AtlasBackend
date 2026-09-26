import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { TracingService } from '../../../src/common/observability/tracing.service.js';
import { installInMemoryTracing, type TracingHarness } from './support/in-memory-tracing.js';

let harness: TracingHarness;
let tracing: TracingService;

beforeAll(() => {
  harness = installInMemoryTracing();
  tracing = new TracingService();
});
beforeEach(() => harness.reset());
afterAll(() => harness.shutdown());

describe('TracingService', () => {
  it('abre el span, ejecuta la operación, la finaliza y devuelve el resultado', async () => {
    const resultado = await tracing.runInSpan('credit.evaluate', { 'app.module': 'credit' }, () => 'aprobado');
    expect(resultado).toBe('aprobado');
    const span = harness.spanNamed('credit.evaluate');
    expect(span).toBeDefined();
    expect(span?.attributes['app.module']).toBe('credit');
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('espera a la promesa antes de cerrar: la duración refleja el trabajo real, no el retorno', async () => {
    await tracing.runInSpan('lento', {}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    const [nanos] = harness.spanNamed('lento')!.duration;
    expect(nanos).toBeGreaterThanOrEqual(0);
    const millis = hrToMillis(harness.spanNamed('lento')!.duration);
    expect(millis).toBeGreaterThanOrEqual(20);
  });

  it('sirve igual para una operación síncrona', async () => {
    await expect(tracing.runInSpan('sincrona', {}, () => 7)).resolves.toBe(7);
    expect(harness.spanNamed('sincrona')).toBeDefined();
  });

  it('ante una excepción la registra, marca el span y RELANZA el error original', async () => {
    const original = Object.assign(new Error('detalle que no debe salir'), { code: 'CUSTOMER_NOT_FOUND' });
    await expect(tracing.runInSpan('falla', {}, () => Promise.reject(original))).rejects.toBe(original);
    const span = harness.spanNamed('falla')!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    // La descripción es el CÓDIGO estable, nunca el mensaje: el mensaje puede llevar PII.
    expect(span.status.message).toBe('CUSTOMER_NOT_FOUND');
    expect(span.attributes['error.type']).toBe('CUSTOMER_NOT_FOUND');
    expect(span.events.map((event) => event.name)).toContain('exception');
  });

  it('cierra el span aunque la operación lance', async () => {
    await expect(tracing.runInSpan('cierra', {}, () => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(harness.spanNamed('cierra')?.ended).toBe(true);
  });

  it('anida: el hijo comparte trace_id con el padre y tiene span_id propio', async () => {
    await tracing.runInSpan('padre', {}, async () => {
      await tracing.runInSpan('hijo', {}, () => undefined);
    });
    const padre = harness.spanNamed('padre')!;
    const hijo = harness.spanNamed('hijo')!;
    expect(hijo.spanContext().traceId).toBe(padre.spanContext().traceId);
    expect(hijo.spanContext().spanId).not.toBe(padre.spanContext().spanId);
    expect(hijo.parentSpanContext?.spanId).toBe(padre.spanContext().spanId);
  });

  it('runInRootSpan abre una traza NUEVA aunque haya una activa', async () => {
    await tracing.runInSpan('peticion', {}, async () => {
      await tracing.runInRootSpan('job.run', {}, () => undefined);
    });
    expect(harness.spanNamed('job.run')!.spanContext().traceId).not.toBe(harness.spanNamed('peticion')!.spanContext().traceId);
  });

  it('admite tipo de span explícito', async () => {
    await tracing.runInSpanWith('publica', { kind: SpanKind.PRODUCER }, () => undefined);
    expect(harness.spanNamed('publica')?.kind).toBe(SpanKind.PRODUCER);
  });

  it('setAttribute, setAttributes y addEvent actúan sobre el span activo', async () => {
    await tracing.runInSpan('con-extras', {}, () => {
      tracing.setAttribute('uno', 1);
      tracing.setAttributes({ dos: 'b' });
      tracing.addEvent('hito', { n: 3 });
    });
    const span = harness.spanNamed('con-extras')!;
    expect(span.attributes).toMatchObject({ uno: 1, dos: 'b' });
    expect(span.events[0]?.name).toBe('hito');
  });

  it('sin span activo, los ayudantes no lanzan ni crean nada', () => {
    expect(trace.getActiveSpan()).toBeUndefined();
    expect(() => {
      tracing.setAttribute('x', 1);
      tracing.setAttributes({ y: 2 });
      tracing.addEvent('z');
      tracing.recordException(new Error('sin contexto'));
    }).not.toThrow();
    expect(harness.spans()).toHaveLength(0);
  });

  it('recordException marca un fallo que se gestionó sin propagarse', async () => {
    await tracing.runInSpan('absorbe', {}, () => {
      tracing.recordException(Object.assign(new Error('adaptador caído'), { code: 'SMS_PROVIDER_DOWN', retryable: true }));
    });
    const span = harness.spanNamed('absorbe')!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes['app.error.retryable']).toBe(true);
  });
});

function hrToMillis([seconds, nanos]: [number, number]): number {
  return seconds * 1000 + nanos / 1e6;
}
