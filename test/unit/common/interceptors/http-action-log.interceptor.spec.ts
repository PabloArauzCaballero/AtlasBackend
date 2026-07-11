import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
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
});
