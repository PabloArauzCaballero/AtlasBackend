import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from '../../../src/modules/runtime-hardening/idempotency.interceptor.js';

/**
 * Fase 1.3 del plan 10/10: la idempotencia es columna vertebral de seguridad de un backend fintech
 * y solo estaba probada a nivel del hash (`test/unit/idempotency-hash.test.ts`). El MECANISMO — el
 * interceptor que reclama la clave, hace replay y persiste el resultado — no tenía prueba directa.
 */

type Claim = { mode: 'execute'; record: unknown } | { mode: 'replay'; responseBody: unknown; responseStatus: number | null };

type FakeRuntime = {
  requestHash: jest.Mock;
  claimIdempotency: jest.Mock;
  completeIdempotency: jest.Mock;
  failIdempotency: jest.Mock;
};

function buildRuntime(claim: Claim): FakeRuntime {
  return {
    requestHash: jest.fn(() => 'hash-1'),
    claimIdempotency: jest.fn(async () => claim),
    completeIdempotency: jest.fn(async () => undefined),
    failIdempotency: jest.fn(async () => undefined),
  } as FakeRuntime;
}

function buildContext(request: Record<string, unknown>, response: Record<string, unknown> = { statusCode: 200 }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function buildNext(handle: jest.Mock): CallHandler {
  return { handle } as unknown as CallHandler;
}

const RECORD = { id: 'rec-1' };

describe('IdempotencyInterceptor', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn(() => of({ ok: true }));
  });

  describe('cuándo NO interviene', () => {
    it('deja pasar métodos no mutantes sin tocar idempotencia', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'GET', headers: { 'x-idempotency-key': 'k1' } });

      await firstValueFrom(interceptor.intercept(context, buildNext(next)));

      expect(next).toHaveBeenCalledTimes(1);
      expect(runtime.claimIdempotency).not.toHaveBeenCalled();
    });

    it('deja pasar mutaciones sin cabecera X-Idempotency-Key', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', headers: {} });

      await firstValueFrom(interceptor.intercept(context, buildNext(next)));

      expect(next).toHaveBeenCalledTimes(1);
      expect(runtime.claimIdempotency).not.toHaveBeenCalled();
    });
  });

  describe('replay', () => {
    it('devuelve la respuesta guardada y NO vuelve a ejecutar el handler', async () => {
      const runtime = buildRuntime({ mode: 'replay', responseBody: { replayed: true }, responseStatus: 201 });
      const status = jest.fn();
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', headers: { 'x-idempotency-key': 'k1' } }, { statusCode: 200, status });

      const result = await firstValueFrom(interceptor.intercept(context, buildNext(next)));

      expect(result).toEqual({ replayed: true });
      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
    });

    it('si el replay no tiene status guardado, no fuerza ninguno', async () => {
      const runtime = buildRuntime({ mode: 'replay', responseBody: { replayed: true }, responseStatus: null });
      const status = jest.fn();
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', headers: { 'x-idempotency-key': 'k1' } }, { statusCode: 200, status });

      await firstValueFrom(interceptor.intercept(context, buildNext(next)));

      expect(status).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('ejecuta el handler y persiste el resultado antes de emitir el body', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', headers: { 'x-idempotency-key': 'k1' } }, { statusCode: 201 });

      const result = await firstValueFrom(interceptor.intercept(context, buildNext(next)));

      expect(result).toEqual({ ok: true });
      expect(runtime.completeIdempotency).toHaveBeenCalledWith(RECORD, 201, { ok: true });
      expect(runtime.failIdempotency).not.toHaveBeenCalled();
    });

    /**
     * Invariante explícito del interceptor: antes se hacía `void completeIdempotency(...)` y la
     * respuesta podía salir OK aunque la persistencia fallara. En un backend fintech, una mutación
     * con X-Idempotency-Key debe quedar registrada ANTES de responder.
     */
    it('si falla la persistencia de idempotencia, la respuesta NO sale OK', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      runtime.completeIdempotency.mockRejectedValue(new Error('db caída') as never);
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', headers: { 'x-idempotency-key': 'k1' } });

      await expect(firstValueFrom(interceptor.intercept(context, buildNext(next)))).rejects.toThrow('db caída');
    });

    it('si el handler falla, marca la clave como fallida y propaga el error original', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      const failing = jest.fn(() => throwError(() => new Error('boom')));
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', headers: { 'x-idempotency-key': 'k1' } });

      await expect(firstValueFrom(interceptor.intercept(context, buildNext(failing)))).rejects.toThrow('boom');
      expect(runtime.failIdempotency).toHaveBeenCalledWith(RECORD);
      expect(runtime.completeIdempotency).not.toHaveBeenCalled();
    });

    it('si además falla el marcado de fallo, sigue propagando el error original del handler', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      runtime.failIdempotency.mockRejectedValue(new Error('fallo secundario') as never);
      const failing = jest.fn(() => throwError(() => new Error('boom')));
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', headers: { 'x-idempotency-key': 'k1' } });

      await expect(firstValueFrom(interceptor.intercept(context, buildNext(failing)))).rejects.toThrow('boom');
    });
  });

  describe('alcance de la clave (aislamiento entre tenants y actores)', () => {
    it('usa el tenant del usuario autenticado y el método+ruta como scope', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({
        method: 'post',
        originalUrl: '/api/v1/customers/1/risk-assessments',
        headers: { 'x-idempotency-key': 'k1', 'x-tenant-id': '9' },
        user: { tenantId: '1', role: 'customer', customerId: '42' },
      });

      await firstValueFrom(interceptor.intercept(context, buildNext(next)));

      expect(runtime.claimIdempotency).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantScope: '1',
          actorType: 'customer',
          actorId: '42',
          idempotencyKey: 'k1',
          scope: 'POST /api/v1/customers/1/risk-assessments',
          requestHash: 'hash-1',
        }),
      );
    });

    it('sin usuario autenticado cae a la cabecera x-tenant-id', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', path: '/p', headers: { 'x-idempotency-key': 'k1', 'x-tenant-id': '7' } });

      await firstValueFrom(interceptor.intercept(context, buildNext(next)));

      expect(runtime.claimIdempotency).toHaveBeenCalledWith(expect.objectContaining({ tenantScope: '7', actorId: null }));
    });

    it('sin usuario ni cabecera usa el scope global', async () => {
      const runtime = buildRuntime({ mode: 'execute', record: RECORD });
      const interceptor = new IdempotencyInterceptor(runtime as never);
      const context = buildContext({ method: 'POST', path: '/p', headers: { 'x-idempotency-key': 'k1' } });

      await firstValueFrom(interceptor.intercept(context, buildNext(next)));

      expect(runtime.claimIdempotency).toHaveBeenCalledWith(expect.objectContaining({ tenantScope: 'global' }));
    });
  });
});
