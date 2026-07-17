import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { BadRequestException, CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { HttpMetricsInterceptor } from '../../../src/common/observability/http-metrics.interceptor.js';

type Observed = { method: string; route: string; statusCode: number; durationSeconds: number };

function buildContext(input: { method: string; routePath?: string; statusCode: number }): ExecutionContext {
  const request = { method: input.method, route: input.routePath ? { path: input.routePath } : undefined };
  const response = { statusCode: input.statusCode };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

describe('HttpMetricsInterceptor', () => {
  let observed: Observed[];
  let interceptor: HttpMetricsInterceptor;

  beforeEach(() => {
    observed = [];
    const metrics = { observeHttpRequest: jest.fn((o: Observed) => observed.push(o)) };
    interceptor = new HttpMetricsInterceptor(metrics as never);
  });

  it('registra el request con método, patrón de ruta y status en un flujo exitoso', async () => {
    const context = buildContext({ method: 'get', routePath: '/api/v1/users/:id', statusCode: 200 });
    const next: CallHandler = { handle: () => of({ ok: true }) };

    await lastValueFrom(interceptor.intercept(context, next));

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ method: 'GET', route: '/api/v1/users/:id', statusCode: 200 });
    expect(observed[0].durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('deriva el status de una HttpException cuando el handler falla', async () => {
    const context = buildContext({ method: 'POST', routePath: '/api/v1/events', statusCode: 200 });
    const next: CallHandler = { handle: () => throwError(() => new BadRequestException('bad')) };

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toThrow(BadRequestException);
    expect(observed[0]).toMatchObject({ route: '/api/v1/events', statusCode: 400 });
  });

  it('usa 500 cuando el error no es una HttpException', async () => {
    const context = buildContext({ method: 'GET', routePath: '/api/v1/risk', statusCode: 200 });
    const next: CallHandler = { handle: () => throwError(() => new Error('boom')) };

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toThrow('boom');
    expect(observed[0]).toMatchObject({ statusCode: 500 });
  });

  it('etiqueta como "unmatched" cuando no hay patrón de ruta (404 sin match de Express)', async () => {
    const context = buildContext({ method: 'GET', statusCode: 404 });
    const next: CallHandler = { handle: () => of(undefined) };

    await lastValueFrom(interceptor.intercept(context, next));
    expect(observed[0].route).toBe('unmatched');
  });
});
