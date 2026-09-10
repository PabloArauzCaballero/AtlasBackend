import { afterEach, describe, expect, it, jest } from '@jest/globals';

/**
 * Cuando Flujos pide a otro bloque una ruta que NO es el manifiesto —hoy, su resumen de accesos—,
 * lo que vuelve es el sobre `{ success, data }` con el que responden estos backends. Si el sobre no
 * se abre, quien indexa el cuerpo no encuentra sus claves y devuelve un índice vacío. El desenlace
 * es el más engañoso de todos: federación `ok: true` y cero corridas, que se lee como «se preguntó
 * bien y ese bloque no ha ejecutado NADA» cuando en realidad ejecutó setenta y ocho rutas.
 */
type ClientModule = typeof import('../../src/modules/systems-ops/platform-catalog-federation.client.js');

const BASE_ENV = {
  ERP_BACKEND_BASE_URL: 'http://erp.local',
  ERP_BACKEND_CATALOG_PATH: '/api/v1/platform/catalog-manifest',
  ERP_BACKEND_CATALOG_TIMEOUT_MS: 5_000,
  ERP_BACKEND_CATALOG_API_KEY: 'clave-de-catalogo-de-mas-de-32-caracteres',
};

async function loadClient(): Promise<ClientModule> {
  jest.resetModules();
  jest.doMock('../../src/config/env.js', () => ({ env: BASE_ENV }));
  return import('../../src/modules/systems-ops/platform-catalog-federation.client.js');
}

describe('PlatformCatalogFederationClient · el sobre de la respuesta', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
    jest.resetModules();
  });

  async function pedir(body: unknown): Promise<unknown> {
    const { PlatformCatalogFederationClient } = await loadClient();
    (globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })) as never;
    const result = (await new PlatformCatalogFederationClient().fetchFromBlock('ERP_BACKEND', null, 'api/v1/platform/access-runs')) as {
      ok: boolean;
      body?: unknown;
    };
    expect(result.ok).toBe(true);
    return result.body;
  }

  it('abre el sobre y entrega el contenido, que es lo que el indexador espera', async () => {
    const body = await pedir({
      success: true,
      data: { since: '2026-09-10T00:00:00Z', scope: 'process', entries: [{ method: 'GET' }] },
    });
    expect(body).toMatchObject({ scope: 'process', entries: [{ method: 'GET' }] });
  });

  it('un cuerpo con `data` propio pero sin `success` NO se abre: no es un sobre', async () => {
    const body = await pedir({ entries: [], data: { esto: 'es del bloque' } });
    expect(body).toMatchObject({ entries: [], data: { esto: 'es del bloque' } });
  });

  it('una respuesta sin sobre se entrega tal cual', async () => {
    const body = await pedir({ resources: [{ resource: 'GET X.y', decision: 'ALLOW', count: 2, lastAt: null }] });
    expect(body).toMatchObject({ resources: [{ decision: 'ALLOW' }] });
  });
});
