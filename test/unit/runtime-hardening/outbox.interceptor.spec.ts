import { describe, expect, it, jest } from '@jest/globals';
import { firstValueFrom, of } from 'rxjs';
import { ApiCommandOutboxInterceptor } from '../../../src/modules/runtime-hardening/outbox.interceptor.js';

/**
 * `ApiCommandOutboxInterceptor` (Fase 1.2 — branch coverage): registra en el outbox toda mutación
 * (POST/PUT/PATCH/DELETE) ANTES de devolver la respuesta, para no perder trazabilidad. Es denso en
 * ramas de derivación (tenant del usuario o del header, aggregateId encadenado, url con fallback,
 * rol público, tipo de resultado). Contexto/handler de Nest y el servicio de runtime mockeados.
 */
describe('ApiCommandOutboxInterceptor', () => {
  function build() {
    const runtime = { emitApiCommandCompleted: jest.fn(async () => undefined) };
    return { interceptor: new ApiCommandOutboxInterceptor(runtime as never), runtime };
  }
  const contextOf = (request: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;
  const handlerOf = (body: unknown) => ({ handle: jest.fn(() => of(body)) }) as never;

  it('no intercepta lecturas (GET): pasa la respuesta sin emitir al outbox', async () => {
    const { interceptor, runtime } = build();
    const result = await firstValueFrom(interceptor.intercept(contextOf({ method: 'GET', headers: {} }), handlerOf({ ok: true })));
    expect(result).toEqual({ ok: true });
    expect(runtime.emitApiCommandCompleted).not.toHaveBeenCalled();
  });

  it('mutación autenticada: toma el tenant del usuario, el customerId como agregado y deriva el eventCode de la url', async () => {
    const { interceptor, runtime } = build();
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/customers/9/risk-assessments',
      params: { customerId: '9' },
      headers: {},
      user: { tenantId: '1', role: 'internal_operator' },
      correlationId: 'corr-1',
    };
    const result = await firstValueFrom(interceptor.intercept(contextOf(request), handlerOf({ id: 'r1' })));
    expect(result).toEqual({ id: 'r1' });
    const arg = (runtime.emitApiCommandCompleted as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      tenantId: '1',
      aggregateType: 'api_command',
      aggregateId: '9',
      eventCode: 'post_api_v1_customers_9_risk_assessments_completed',
      correlationId: 'corr-1',
    });
    expect(arg.payload).toMatchObject({ method: 'POST', actorRole: 'internal_operator', resultType: 'object' });
  });

  it('mutación pública: tenant del header, rol public_or_unknown, agregado nulo, path de respaldo y correlation null', async () => {
    const { interceptor, runtime } = build();
    const request = {
      method: 'DELETE',
      path: '/api/v1/sessions',
      params: {},
      headers: { 'x-tenant-id': '7' },
    };
    await firstValueFrom(interceptor.intercept(contextOf(request), handlerOf('texto')));
    const arg = (runtime.emitApiCommandCompleted as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      tenantId: '7',
      aggregateId: null,
      eventCode: 'delete_api_v1_sessions_completed',
      correlationId: null,
    });
    expect(arg.payload).toMatchObject({ actorRole: 'public_or_unknown', resultType: 'string', path: '/api/v1/sessions' });
  });

  it('el aggregateId cae en cascada customerId -> caseId -> sessionId', async () => {
    const { interceptor, runtime } = build();
    const base = { method: 'PATCH', originalUrl: '/x', headers: {} };
    await firstValueFrom(interceptor.intercept(contextOf({ ...base, params: { caseId: 'c9' } }), handlerOf(null)));
    await firstValueFrom(interceptor.intercept(contextOf({ ...base, params: { sessionId: 's9' } }), handlerOf(null)));
    const calls = (runtime.emitApiCommandCompleted as jest.Mock).mock.calls as Array<[Record<string, unknown>]>;
    expect(calls[0][0].aggregateId).toBe('c9');
    expect(calls[1][0].aggregateId).toBe('s9');
  });

  it('url desconocida (sin originalUrl ni path) usa "unknown" en el eventCode', async () => {
    const { interceptor, runtime } = build();
    await firstValueFrom(interceptor.intercept(contextOf({ method: 'PUT', headers: {} }), handlerOf(undefined)));
    const arg = (runtime.emitApiCommandCompleted as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(arg.eventCode).toBe('put_unknown_completed');
    expect((arg.payload as Record<string, unknown>).resultType).toBe('undefined');
  });
});
