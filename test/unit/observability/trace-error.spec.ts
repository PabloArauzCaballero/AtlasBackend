import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { SpanStatusCode } from '@opentelemetry/api';
import { recordHttpFailure, stableErrorCode } from '../../../src/common/observability/trace-error.js';
import { TracingService } from '../../../src/common/observability/tracing.service.js';
import { installInMemoryTracing, type TracingHarness } from './support/in-memory-tracing.js';

let harness: TracingHarness;
const tracing = new TracingService();

beforeAll(() => {
  harness = installInMemoryTracing();
});
beforeEach(() => harness.reset());
afterAll(() => harness.shutdown());

describe('código estable de error', () => {
  it('lee `code`, la convención de los errores de este repositorio', () => {
    expect(stableErrorCode(Object.assign(new Error('x'), { code: 'CUSTOMER_ALREADY_EXISTS' }))).toBe('CUSTOMER_ALREADY_EXISTS');
  });

  it('acepta también `errorCode`', () => {
    expect(stableErrorCode({ errorCode: 'EVENT_INVALID_SCOPE' })).toBe('EVENT_INVALID_SCOPE');
  });

  it('cae al nombre del error cuando no hay código', () => {
    expect(stableErrorCode(new TypeError('x'))).toBe('TypeError');
  });

  it('un valor lanzado que no es Error no se interpreta: sale como desconocido', () => {
    // Importa porque una cadena lanzada podría contener el dato de un solicitante.
    expect(stableErrorCode('7712345 no existe')).toBe('UNKNOWN_ERROR');
  });
});

describe('fallo que llega al límite HTTP', () => {
  it('un 5xx marca el span como error y registra la excepción', async () => {
    await tracing.runInSpan('peticion', {}, () => {
      recordHttpFailure(500, Object.assign(new Error('boom'), { code: 'DB_UNAVAILABLE' }));
    });
    const span = harness.spanNamed('peticion')!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe('DB_UNAVAILABLE');
    expect(span.events.map((event) => event.name)).toContain('exception');
  });

  it('un 4xx deja el código pero NO marca el span: el llamante se equivocó, no el servicio', async () => {
    await tracing.runInSpan('peticion', {}, () => {
      recordHttpFailure(400, Object.assign(new Error('campo inválido'), { code: 'VALIDATION_ERROR' }));
    });
    const span = harness.spanNamed('peticion')!;
    expect(span.attributes['error.type']).toBe('VALIDATION_ERROR');
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.events).toHaveLength(0);
  });

  it('una respuesta correcta no toca nada', async () => {
    await tracing.runInSpan('peticion', {}, () => recordHttpFailure(200, undefined));
    const span = harness.spanNamed('peticion')!;
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.attributes['error.type']).toBeUndefined();
  });

  it('sin span activo no lanza', () => {
    expect(() => recordHttpFailure(500, new Error('x'))).not.toThrow();
  });

  it('el mensaje del error NO aparece como descripción del estado', async () => {
    // El mensaje puede traer fragmentos del cuerpo de la petición: carnet, teléfono, correo.
    await tracing.runInSpan('peticion', {}, () => {
      recordHttpFailure(500, Object.assign(new Error('fallo al insertar 7712345 / ana@ejemplo.com'), { code: 'DB_WRITE_FAILED' }));
    });
    expect(harness.spanNamed('peticion')!.status.message).toBe('DB_WRITE_FAILED');
    expect(harness.spanNamed('peticion')!.status.message).not.toContain('7712345');
  });
});
