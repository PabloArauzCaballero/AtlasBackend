import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { env } from '../../../src/config/env.js';
import { SystemsTestHttpClientService } from '../../../src/modules/systems-ops/systems-test-http-client.service.js';

/**
 * Cobertura de `SystemsTestHttpClientService` (Fase 1.2): el cliente HTTP del runner de pruebas de
 * systems-ops. En entorno LOCAL la política de URL solo valida la allowlist de host (sin DNS), así que
 * configurando `SYSTEM_TEST_ALLOWED_HOSTS_LOCAL` y mockeando `global.fetch` se cubren execute (éxito,
 * redirect bloqueado, cuerpo no-JSON, error de red/política) y buildUrl.
 */
describe('SystemsTestHttpClientService', () => {
  const service = new SystemsTestHttpClientService();
  let savedHosts: unknown;
  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    savedHosts = (env as Record<string, unknown>).SYSTEM_TEST_ALLOWED_HOSTS_LOCAL;
    savedFetch = global.fetch;
    (env as Record<string, unknown>).SYSTEM_TEST_ALLOWED_HOSTS_LOCAL = 'localhost';
  });
  afterEach(() => {
    (env as Record<string, unknown>).SYSTEM_TEST_ALLOWED_HOSTS_LOCAL = savedHosts;
    global.fetch = savedFetch;
  });

  const req = (over: Partial<Parameters<SystemsTestHttpClientService['execute']>[0]> = {}) => ({
    baseUrl: 'http://localhost:3000',
    path: '/health',
    method: 'POST',
    headers: {},
    payload: { a: 1 },
    timeoutMs: 1000,
    environment: 'LOCAL' as const,
    ...over,
  });

  it('buildUrl compone la URL permitida y lanza BadRequest ante una inválida', () => {
    expect(service.buildUrl('http://localhost:3000', '/x', 'LOCAL')).toBe('http://localhost:3000/x');
    // path relativo mal formado -> la política lanza -> se traduce a BadRequest
    expect(() => service.buildUrl('http://localhost:3000', 'no-slash', 'LOCAL')).toThrow(BadRequestException);
  });

  it('execute (éxito) devuelve statusCode + body parseado', async () => {
    global.fetch = jest.fn(async (..._args: unknown[]) => ({ status: 200, text: async () => '{"ok":true}' })) as never;
    const res = await service.execute(req());
    expect(res).toEqual({ statusCode: 200, responseBody: { ok: true }, errorMessage: null });
  });

  it('execute bloquea las redirecciones (3xx) sin seguirlas', async () => {
    global.fetch = jest.fn(async (..._args: unknown[]) => ({ status: 302, text: async () => '' })) as never;
    const res = await service.execute(req());
    expect(res).toMatchObject({ statusCode: 302, errorMessage: 'SYSTEM_TEST_REDIRECT_BLOCKED' });
  });

  it('execute con cuerpo no-JSON lo envuelve en { raw }', async () => {
    global.fetch = jest.fn(async (..._args: unknown[]) => ({ status: 200, text: async () => 'texto plano' })) as never;
    const res = await service.execute(req({ method: 'GET' }));
    expect(res.responseBody).toEqual({ raw: 'texto plano' });
  });

  it('execute captura el error (host fuera de la allowlist) devolviendo errorMessage y statusCode null', async () => {
    (env as Record<string, unknown>).SYSTEM_TEST_ALLOWED_HOSTS_LOCAL = ''; // ningún host permitido
    global.fetch = jest.fn() as never;
    const res = await service.execute(req());
    expect(res.statusCode).toBeNull();
    expect(res.errorMessage).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('execute captura un fallo de red (fetch lanza)', async () => {
    global.fetch = jest.fn(async (..._args: unknown[]) => {
      throw new Error('ECONNREFUSED');
    }) as never;
    const res = await service.execute(req());
    expect(res).toMatchObject({ statusCode: null, errorMessage: 'ECONNREFUSED' });
  });
});
