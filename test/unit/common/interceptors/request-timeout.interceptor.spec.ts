import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { firstValueFrom, of, throwError, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { RequestTimeoutInterceptor } from '../../../../src/common/interceptors/request-timeout.interceptor.js';
import { env } from '../../../../src/config/env.js';

/**
 * Hallazgo A-07 de `docs/audit/auditoria-integral-2026-07-30.md`: sin techo de duración, un handler
 * colgado retiene su conexión del pool indefinidamente y, con el pool agotado, la degradación deja
 * de ser local a ese endpoint y se lleva por delante a toda la API.
 */
describe('RequestTimeoutInterceptor', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const originalTimeout = mutableEnv.REQUEST_TIMEOUT_MS;

  afterEach(() => {
    mutableEnv.REQUEST_TIMEOUT_MS = originalTimeout;
  });

  const contextFor = (url: string): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => ({ originalUrl: url }) }) }) as unknown as ExecutionContext;

  /** Handler que nunca termina dentro del plazo. */
  const slowHandler = { handle: () => timer(5_000).pipe(map(() => 'tarde')) };
  const fastHandler = { handle: () => of('a tiempo') };

  it('deja pasar una respuesta que llega dentro del plazo', async () => {
    mutableEnv.REQUEST_TIMEOUT_MS = 50;

    const result = await firstValueFrom(new RequestTimeoutInterceptor().intercept(contextFor('/api/v1/customers'), fastHandler));

    expect(result).toBe('a tiempo');
  });

  it('convierte el timeout en 503 REQUEST_TIMEOUT_EXCEEDED', async () => {
    mutableEnv.REQUEST_TIMEOUT_MS = 20;

    await expect(
      firstValueFrom(new RequestTimeoutInterceptor().intercept(contextFor('/api/v1/customers'), slowHandler)),
    ).rejects.toBeInstanceOf(RequestTimeoutException);
  });

  it('no disfraza de timeout un error de negocio del handler', async () => {
    mutableEnv.REQUEST_TIMEOUT_MS = 1_000;
    const failing = { handle: () => throwError(() => new Error('fallo de dominio')) };

    await expect(firstValueFrom(new RequestTimeoutInterceptor().intercept(contextFor('/api/v1/customers'), failing))).rejects.toThrow(
      'fallo de dominio',
    );
  });

  it('con REQUEST_TIMEOUT_MS=0 no aplica ningún techo', async () => {
    mutableEnv.REQUEST_TIMEOUT_MS = 0;
    const handle = jest.fn(() => of('sin techo'));

    const result = await firstValueFrom(new RequestTimeoutInterceptor().intercept(contextFor('/api/v1/customers'), { handle }));

    expect(result).toBe('sin techo');
  });

  it('exime a /metrics y a los probes de salud: si el proceso está saturado, lo último que conviene es dejar de reportarlo', async () => {
    mutableEnv.REQUEST_TIMEOUT_MS = 20;

    for (const exempt of ['/metrics', '/api/v1/health', '/api/v1/health/readiness']) {
      const handle = jest.fn(() => of('ok'));
      await expect(firstValueFrom(new RequestTimeoutInterceptor().intercept(contextFor(exempt), { handle }))).resolves.toBe('ok');
    }
  });
});
