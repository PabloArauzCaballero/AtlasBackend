import { ServiceUnavailableException } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { OpenApiCatalogService } from '../../../src/modules/systems-ops/openapi-catalog.service.js';
import { OpenApiDocumentRegistry } from '../../../src/modules/systems-ops/openapi-document.registry.js';

function build(document: OpenAPIObject | null) {
  const registry = new OpenApiDocumentRegistry();
  if (document) registry.set(document);
  const repository = { upsertEndpoint: jest.fn(async (..._args: unknown[]) => undefined) };
  const classifier = {
    riskLevelForEndpoint: jest.fn(() => 'MEDIUM' as const),
    containsPiiForEndpoint: jest.fn(() => false),
  };
  const service = new OpenApiCatalogService(registry, repository as never, classifier as never);
  return { service, repository, classifier };
}

const DOCUMENT = {
  openapi: '3.1.0',
  info: { title: 'Atlas', version: '1' },
  components: { schemas: {} },
  paths: {
    '/api/v1/auth/login': {
      post: {
        summary: 'Iniciar sesión',
        operationId: 'login',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { email: { type: 'string' }, password: { type: 'string' } },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: { '200': {}, '401': {} },
      },
    },
    '/api/v1/customers/{customerId}': {
      parameters: [{ in: 'path', name: 'customerId', required: true, schema: { type: 'string' } }],
      get: {
        summary: 'Obtener cliente',
        parameters: [{ in: 'query', name: 'include', required: false, schema: { type: 'string' } }],
        responses: { '200': {} },
      },
      delete: { summary: 'Borrar cliente', responses: { '204': {} } },
    },
  },
} as unknown as OpenAPIObject;

describe('OpenApiCatalogService', () => {
  it('cataloga una operación por método declarado', async () => {
    const { service } = build(DOCUMENT);
    const seeds = service.buildSeeds(DOCUMENT);

    expect(seeds).toHaveLength(3);
    expect(seeds.map((seed) => `${seed.method} ${seed.fullPath}`).sort()).toEqual([
      'DELETE /api/v1/customers/{customerId}',
      'GET /api/v1/customers/{customerId}',
      'POST /api/v1/auth/login',
    ]);
  });

  /**
   * Es el defecto que este servicio existe para corregir: sólo 5 de 404 endpoints del catálogo
   * declaraban su contrato de entrada, así que el generador de datos de prueba del portal no tenía
   * de dónde derivar valores en 399 de ellos.
   */
  it('rellena el contrato de entrada desde el cuerpo declarado', () => {
    const { service } = build(DOCUMENT);
    const login = service.buildSeeds(DOCUMENT).find((seed) => seed.fullPath === '/api/v1/auth/login');

    expect(login?.minPayloadSchema).toEqual({ email: 'string|required', password: 'string|required' });
  });

  it('mezcla los parámetros de la ruta con los de la operación', () => {
    const { service } = build(DOCUMENT);
    const get = service.buildSeeds(DOCUMENT).find((seed) => seed.method === 'GET');

    expect(get?.pathParamsSchema).toEqual({ customerId: 'string|required' });
    expect(get?.queryParamsSchema).toEqual({ include: 'string|optional' });
  });

  /**
   * El escáner anterior escribía `[201]` para todo POST y `[200]` para el resto: una afirmación
   * inventada sobre el contrato de salida que el laboratorio de QA usaba como criterio de aprobación.
   */
  it('publica los códigos de éxito DECLARADOS, no los supuestos', () => {
    const { service } = build(DOCUMENT);
    const seeds = service.buildSeeds(DOCUMENT);

    expect(seeds.find((seed) => seed.method === 'POST')?.expectedStatusCodes).toEqual([200]);
    expect(seeds.find((seed) => seed.method === 'DELETE')?.expectedStatusCodes).toEqual([204]);
  });

  it('`security: []` marca el endpoint como público; su ausencia, no', () => {
    const { service } = build(DOCUMENT);
    const seeds = service.buildSeeds(DOCUMENT);

    expect(seeds.find((seed) => seed.fullPath === '/api/v1/auth/login')?.requiresAuth).toBe(false);
    expect(seeds.find((seed) => seed.method === 'GET')?.requiresAuth).toBe(true);
  });

  it('marca destructivo el DELETE y de solo lectura el GET', () => {
    const { service } = build(DOCUMENT);
    const seeds = service.buildSeeds(DOCUMENT);

    expect(seeds.find((seed) => seed.method === 'DELETE')?.isDestructive).toBe(true);
    expect(seeds.find((seed) => seed.method === 'GET')?.isReadonly).toBe(true);
  });

  it('persiste sólo cuando se le pide y cuenta cuántos traen contrato', async () => {
    const { service, repository } = build(DOCUMENT);

    const dryRun = await service.catalogFromContract(false);
    expect(repository.upsertEndpoint).not.toHaveBeenCalled();
    expect(dryRun).toMatchObject({ discovered: 3, persisted: 0, withContract: 1 });

    const persisted = await service.catalogFromContract(true);
    expect(repository.upsertEndpoint).toHaveBeenCalledTimes(3);
    expect(persisted.persisted).toBe(3);
  });

  /**
   * Sin documento se FALLA, no se devuelve «cero endpoints». Es la lección del escáner de código al
   * que sustituye: un catálogo vacío y un catálogo que no se pudo leer piden acciones opuestas.
   */
  it('sin contrato en memoria falla en vez de reportar un catálogo vacío', async () => {
    const { service } = build(null);

    await expect(service.catalogFromContract(false)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
