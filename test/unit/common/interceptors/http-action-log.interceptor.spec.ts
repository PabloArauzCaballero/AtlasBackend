import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { CallHandler, ExecutionContext, Logger, NotFoundException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { HttpActionLogInterceptor } from '../../../../src/common/interceptors/http-action-log.interceptor.js';
import type { HttpActionLogService } from '../../../../src/modules/audit/http-action-log.service.js';

/**
 * Regresión: antes de este fix, la respuesta de TODA request HTTP autenticada esperaba a que el
 * INSERT del audit log terminara antes de emitirse (`mergeMap` sobre la promesa de
 * `createHttpAction`). Estos tests fijan el contrato de que el audit log es fire-and-forget: la
 * respuesta se emite de inmediato y un fallo en el write del log nunca revienta ni retrasa la
 * respuesta al cliente.
 */
function buildContext(): ExecutionContext {
  const request = {
    method: 'GET',
    originalUrl: '/api/v1/customers/1',
    headers: {},
    params: { customerId: '1' },
  };
  const response = { statusCode: 200 };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function buildHandler(body: unknown): CallHandler {
  return { handle: () => of(body) };
}

describe('HttpActionLogInterceptor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits the response body without waiting for the audit log write to resolve', async () => {
    const events: string[] = [];
    let resolveAuditWrite: () => void = () => undefined;
    const auditWritePromise = new Promise<{ id: string }>((resolve) => {
      resolveAuditWrite = () => resolve({ id: 'log-1' });
    });
    const actionLog = {
      createHttpAction: jest.fn(() => {
        events.push('audit-write-started');
        return auditWritePromise;
      }),
    };

    const interceptor = new HttpActionLogInterceptor(actionLog as unknown as HttpActionLogService);
    const result = await firstValueFrom(interceptor.intercept(buildContext(), buildHandler({ ok: true })));
    events.push('response-emitted');

    // La respuesta ya se emitió (y este await ya se resolvió) mientras el write del audit log
    // sigue pendiente — si el interceptor todavía esperara la promesa, "response-emitted" nunca
    // se alcanzaría antes de resolver `auditWritePromise` manualmente.
    expect(result).toEqual({ ok: true });
    expect(events).toEqual(['audit-write-started', 'response-emitted']);

    resolveAuditWrite();
    await auditWritePromise;
  });

  it('does not throw or reject the response when the audit log write fails', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const actionLog = {
      createHttpAction: jest.fn(() => Promise.reject(new Error('db unavailable'))),
    };

    const interceptor = new HttpActionLogInterceptor(actionLog as unknown as HttpActionLogService);
    const result = await firstValueFrom(interceptor.intercept(buildContext(), buildHandler({ ok: true })));

    expect(result).toEqual({ ok: true });

    // Deja que el `.catch` interno del fire-and-forget corra antes de assertar el warning.
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Fallo escribiendo audit log HTTP'));
  });

  describe('derivación del registro (ramas de actor, target, ip, riesgo y estado)', () => {
    const ctx = (request: Record<string, unknown>, response: Record<string, unknown> = { statusCode: 200 }) =>
      ({ switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) }) as unknown as ExecutionContext;
    const build = () => {
      const actionLog = { createHttpAction: jest.fn(async () => undefined) };
      return { interceptor: new HttpActionLogInterceptor(actionLog as unknown as HttpActionLogService), actionLog };
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const lastCall = (actionLog: { createHttpAction: jest.Mock }) =>
      (actionLog.createHttpAction as jest.Mock).mock.calls.at(-1)?.[0] as Record<string, unknown>;

    it('actor autenticado en ruta PII: tenant/rol del usuario, ip del x-forwarded-for, requestId del header y riesgo MEDIUM', async () => {
      const { interceptor, actionLog } = build();
      const request = {
        method: 'POST',
        originalUrl: '/api/v1/customers/9/consents?x=1',
        params: { customerId: '9' },
        headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'ua', 'x-request-id': 'req-1', 'x-idempotency-key': 'idem-1' },
        ip: '10.0.0.9',
        user: { tenantId: '1', role: 'customer', sub: 'u1', customerId: '9', internalUserId: null, platformUserId: null },
        route: { path: '/customers/:customerId/consents' },
      };
      await firstValueFrom(interceptor.intercept(ctx(request), buildHandler({ ok: true })));
      await flush();

      expect(lastCall(actionLog)).toMatchObject({
        tenantId: '1',
        actorType: 'customer',
        actorRole: 'customer',
        actorUserId: 'u1',
        targetId: '9',
        ipAddress: '203.0.113.7',
        userAgent: 'ua',
        requestId: 'req-1',
        correlationId: 'req-1',
        routeTemplate: '/customers/:customerId/consents',
        idempotencyKey: 'idem-1',
        riskLevel: 'MEDIUM',
        containsPii: true,
        responseStatusCode: 200,
        errorCode: null,
        // la query se recorta del path registrado
        resolvedUrlSanitized: '/api/v1/customers/9/consents',
      });
    });

    it('request pública en ruta no-PII: actor public_or_unknown, tenant del header, ip del socket, riesgo LOW y target nulo', async () => {
      const { interceptor, actionLog } = build();
      const request = { method: 'GET', url: '/api/v1/health', headers: { 'x-tenant-id': '7' }, ip: '10.0.0.9', correlationId: 'corr-1' };
      await firstValueFrom(interceptor.intercept(ctx(request), buildHandler('ok')));
      await flush();

      expect(lastCall(actionLog)).toMatchObject({
        tenantId: '7',
        actorType: 'public_or_unknown',
        actorRole: 'public_or_unknown',
        actorUserId: null,
        actorInternalUserId: null,
        actorPlatformUserId: null,
        targetId: null,
        ipAddress: '10.0.0.9',
        requestId: 'corr-1',
        routeTemplate: null,
        idempotencyKey: null,
        riskLevel: 'LOW',
        containsPii: false,
      });
    });

    it('targetId cae en cascada por params y luego por el actor', async () => {
      const { interceptor, actionLog } = build();
      const base = { method: 'GET', url: '/api/v1/x', headers: {} };
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ params: { caseId: 'case-1' } }, 'case-1'],
        [{ params: { sessionId: 'sess-1' } }, 'sess-1'],
        [{ params: { id: 'id-1' } }, 'id-1'],
        [{ user: { internalUserId: 'iu-1' } }, 'iu-1'],
        [{ user: { platformUserId: 'pu-1' } }, 'pu-1'],
        [{ user: { sub: 'sub-1' } }, 'sub-1'],
      ];
      for (const [extra, expected] of cases) {
        await firstValueFrom(interceptor.intercept(ctx({ ...base, ...extra }), buildHandler(null)));
        await flush();
        expect(lastCall(actionLog).targetId).toBe(expected);
      }
    });

    it('riesgo HIGH cuando la respuesta es 5xx', async () => {
      const { interceptor, actionLog } = build();
      await firstValueFrom(interceptor.intercept(ctx({ method: 'GET', url: '/api/v1/health', headers: {} }, { statusCode: 503 }), buildHandler(null)));
      await flush();
      expect(lastCall(actionLog)).toMatchObject({ responseStatusCode: 503, riskLevel: 'HIGH' });
    });

    it('error HttpException: registra su status y outcome error, y re-lanza el error al cliente', async () => {
      const { interceptor, actionLog } = build();
      const handler = { handle: () => throwError(() => new NotFoundException('no está')) } as CallHandler;
      await expect(firstValueFrom(interceptor.intercept(ctx({ method: 'GET', url: '/api/v1/customers/1', headers: {} }), handler))).rejects.toThrow(
        NotFoundException,
      );
      expect(lastCall(actionLog)).toMatchObject({ responseStatusCode: 404, errorCode: 'HTTP_REQUEST_ERROR', errorMessage: 'no está' });
    });

    it('error no-HTTP: usa el statusCode de la respuesta si ya es >=400, si no 500', async () => {
      const withResponseStatus = build();
      const boom = { handle: () => throwError(() => new Error('boom')) } as CallHandler;
      await expect(
        firstValueFrom(withResponseStatus.interceptor.intercept(ctx({ method: 'GET', url: '/x', headers: {} }, { statusCode: 422 }), boom)),
      ).rejects.toThrow('boom');
      expect(lastCall(withResponseStatus.actionLog)).toMatchObject({ responseStatusCode: 422, errorMessage: 'boom' });

      const fallback = build();
      await expect(
        firstValueFrom(fallback.interceptor.intercept(ctx({ method: 'GET', url: '/x', headers: {} }, { statusCode: 200 }), boom)),
      ).rejects.toThrow('boom');
      expect(lastCall(fallback.actionLog)).toMatchObject({ responseStatusCode: 500 });
    });

    it('si el registro del error también falla, el error original igual llega al cliente', async () => {
      const actionLog = { createHttpAction: jest.fn(async () => { throw new Error('log down'); }) };
      const interceptor = new HttpActionLogInterceptor(actionLog as unknown as HttpActionLogService);
      const boom = { handle: () => throwError(() => new Error('original')) } as CallHandler;
      await expect(firstValueFrom(interceptor.intercept(ctx({ method: 'GET', url: '/x', headers: {} }), boom))).rejects.toThrow('original');
    });
  });
});
