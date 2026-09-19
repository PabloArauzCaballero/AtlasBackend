import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { TraceResponseInterceptor } from '../../../src/common/observability/trace-response.interceptor.js';
import { TracingService } from '../../../src/common/observability/tracing.service.js';
import { installInMemoryTracing, type TracingHarness } from './support/in-memory-tracing.js';

let harness: TracingHarness;
const tracing = new TracingService();
const interceptor = new TraceResponseInterceptor();

beforeAll(() => {
  harness = installInMemoryTracing();
});
beforeEach(() => harness.reset());
afterAll(() => harness.shutdown());

type Respuesta = { headersSent: boolean; setHeader: jest.Mock };

function contextoHttp(respuesta: Respuesta, tipo = 'http'): ExecutionContext {
  return {
    getType: () => tipo,
    switchToHttp: () => ({ getResponse: () => respuesta }),
  } as unknown as ExecutionContext;
}

function respuesta(headersSent = false): Respuesta {
  return { headersSent, setHeader: jest.fn() };
}

const siguiente = (valor: unknown = { ok: true }): CallHandler => ({ handle: () => of(valor) });

describe('cabecera x-trace-id', () => {
  it('publica el trace_id del span activo', async () => {
    const res = respuesta();
    await tracing.runInSpan('peticion', {}, async () => {
      await lastValueFrom(interceptor.intercept(contextoHttp(res), siguiente()));
    });
    const traceId = harness.spanNamed('peticion')!.spanContext().traceId;
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', traceId);
  });

  it('conserva la respuesta intacta: el contrato JSON no cambia', async () => {
    const cuerpo = { datos: [1, 2, 3] };
    const recibido = await tracing.runInSpan('peticion', {}, () =>
      lastValueFrom(interceptor.intercept(contextoHttp(respuesta()), siguiente(cuerpo))),
    );
    expect(recibido).toBe(cuerpo);
  });

  it('SIN span activo no emite cabecera: una vacía mandaría a buscar algo que no existe', async () => {
    const res = respuesta();
    await lastValueFrom(interceptor.intercept(contextoHttp(res), siguiente()));
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('no escribe sobre una respuesta ya enviada (descarga, stream)', async () => {
    const res = respuesta(true);
    await tracing.runInSpan('peticion', {}, async () => {
      await lastValueFrom(interceptor.intercept(contextoHttp(res), siguiente()));
    });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('fuera de un contexto HTTP no toca nada', async () => {
    const res = respuesta();
    await tracing.runInSpan('peticion', {}, async () => {
      await lastValueFrom(interceptor.intercept(contextoHttp(res, 'rpc'), siguiente()));
    });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('deja pasar la excepción sin convertirla en éxito', async () => {
    const error = new Error('fallo del manejador');
    const res = respuesta();
    await expect(
      tracing.runInSpan('peticion', {}, () =>
        lastValueFrom(interceptor.intercept(contextoHttp(res), { handle: () => throwError(() => error) })),
      ),
    ).rejects.toBe(error);
    // La cabecera se fija ANTES de ejecutar el manejador, así que un 5xx también la lleva.
    expect(res.setHeader).toHaveBeenCalled();
  });
});
