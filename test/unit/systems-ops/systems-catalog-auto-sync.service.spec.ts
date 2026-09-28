import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { OpenAPIObject } from '@nestjs/swagger';
import { env } from '../../../src/config/env.js';
import { OpenApiDocumentRegistry } from '../../../src/modules/systems-ops/openapi-document.registry.js';
import { OpenApiCatalogService } from '../../../src/modules/systems-ops/openapi-catalog.service.js';
import { structuralFromSeed, SystemsCatalogAutoSyncService } from '../../../src/modules/systems-ops/systems-catalog-auto-sync.service.js';
import type { FederationOutcome } from '../../../src/modules/systems-ops/platform-catalog-manifest.types.js';

/**
 * En TEST (2026-09-28) «Salud de la red» decía «Endpoints 0» para Atlas Backend y «nunca federado»
 * para el motor y el ERP: el catálogo sólo se llenaba pulsando botones que en un despliegue limpio
 * nadie había pulsado. Estas pruebas fijan que la puesta al día corre sola, que no pisa lo que una
 * persona gobernó y que deja constancia para que el panel distinga «cero» de «sin medir».
 */
const DOCUMENT = {
  openapi: '3.1.0',
  info: { title: 'Atlas', version: '1' },
  components: { schemas: {} },
  paths: {
    '/api/v1/customers/{customerId}': { get: { summary: 'Obtener cliente', responses: { '200': {} } } },
    '/api/v1/auth/login': { post: { summary: 'Iniciar sesión', security: [], responses: { '200': {} } } },
  },
} as unknown as OpenAPIObject;

const FEDERATED: FederationOutcome[] = [
  {
    systemCode: 'DECISION_ENGINE',
    status: 'OK',
    message: 'ok',
    endpointsImported: 241,
    dataEntitiesImported: 100,
    remoteVersion: '2.0.0',
    remoteCommit: null,
  },
  {
    systemCode: 'ERP_BACKEND',
    status: 'NOT_CONFIGURED',
    message: 'sin llave',
    endpointsImported: 0,
    dataEntitiesImported: 0,
    remoteVersion: null,
    remoteCommit: null,
  },
];

function build(options: { document?: OpenAPIObject | null; lockAcquired?: boolean; existingCodes?: string[] } = {}) {
  const registry = new OpenApiDocumentRegistry();
  if (options.document !== null) registry.set(options.document ?? DOCUMENT);
  const classifier = { riskLevelForEndpoint: jest.fn(() => 'MEDIUM' as const), containsPiiForEndpoint: jest.fn(() => false) };
  const openApiCatalog = new OpenApiCatalogService(registry, { upsertEndpoint: jest.fn() } as never, classifier as never);
  const catalogRepository = { upsertEndpoint: jest.fn(async (..._args: unknown[]) => undefined) };
  const existing = new Set(options.existingCodes ?? []);
  const rows = new Map<string, { code: string; status: string }>();
  const federationRepository = {
    findEndpointByCode: jest.fn(async (code: string) => {
      if (!existing.has(code)) return null;
      const row = rows.get(code) ?? { code, status: 'ACTIVE' };
      rows.set(code, row);
      return row;
    }),
    refreshEndpointStructure: jest.fn(async (..._args: unknown[]) => undefined),
    deprecateMissingEndpoints: jest.fn(async (..._args: unknown[]) => 0),
    countDataEntities: jest.fn(async () => 220),
    recordOutcome: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const federation = { federateAll: jest.fn(async (..._args: unknown[]) => FEDERATED) };
  const transaction = { rollback: jest.fn(async () => undefined) };
  const sequelize = {
    transaction: jest.fn(async () => transaction),
    query: jest.fn(async () => [{ acquired: options.lockAcquired ?? true }]),
  };
  const service = new SystemsCatalogAutoSyncService(
    sequelize as never,
    registry,
    openApiCatalog,
    catalogRepository as never,
    federationRepository as never,
    federation as never,
  );
  return { service, catalogRepository, federationRepository, federation, sequelize, transaction };
}

describe('SystemsCatalogAutoSyncService · rutas propias', () => {
  it('cataloga las rutas del contrato y deja constancia de un éxito medido', async () => {
    const { service, catalogRepository, federationRepository } = build();

    const outcome = await service.syncSelf();

    expect(outcome).toMatchObject({ systemCode: 'ATLAS_BACKEND', status: 'OK', endpointsImported: 2, dataEntitiesImported: 220 });
    expect(catalogRepository.upsertEndpoint).toHaveBeenCalledTimes(2);
    expect(federationRepository.recordOutcome).toHaveBeenCalledWith(outcome);
  });

  it('en una ruta que ya existe refresca la estructura y NO la reinserta (no pisa la revisión)', async () => {
    const { service, catalogRepository, federationRepository } = build();
    const codes = new OpenApiCatalogService(
      new OpenApiDocumentRegistry(),
      {} as never,
      {
        riskLevelForEndpoint: () => 'LOW',
        containsPiiForEndpoint: () => false,
      } as never,
    )
      .buildSeeds(DOCUMENT)
      .map((seed) => seed.code);
    federationRepository.findEndpointByCode.mockImplementation(async (code: string) =>
      code === codes[0] ? ({ code, status: 'ACTIVE' } as never) : null,
    );

    await service.syncSelf();

    expect(federationRepository.refreshEndpointStructure).toHaveBeenCalledTimes(1);
    expect(catalogRepository.upsertEndpoint).toHaveBeenCalledTimes(1);
  });

  it('sólo retira lo que puso el propio contrato, no lo sembrado a mano', async () => {
    const { service, federationRepository } = build();
    await service.syncSelf();
    expect(federationRepository.deprecateMissingEndpoints).toHaveBeenCalledWith('ATLAS_BACKEND', expect.any(Array), 'openapi_contract');
  });

  it('sin contrato registra un ERROR con motivo, nunca «0 rutas» como si fuera medido', async () => {
    const { service, federationRepository, catalogRepository } = build({ document: null });

    const outcome = await service.syncSelf();

    expect(outcome.status).toBe('ERROR');
    expect(outcome.message).toMatch(/no generó su contrato/);
    expect(catalogRepository.upsertEndpoint).not.toHaveBeenCalled();
    expect(federationRepository.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERROR' }));
  });

  it('un fallo de base al escribir se registra como ERROR y no escapa', async () => {
    const { service, catalogRepository } = build();
    catalogRepository.upsertEndpoint.mockRejectedValueOnce(new Error('conexión perdida'));

    const outcome = await service.syncSelf();

    expect(outcome).toMatchObject({ status: 'ERROR' });
    expect(outcome.message).toMatch(/conexión perdida/);
  });
});

describe('SystemsCatalogAutoSyncService · pasada completa', () => {
  it('cataloga lo propio y federa los bloques SIN sesión de persona', async () => {
    const { service, federation, transaction } = build();

    const result = await service.run('prueba');

    expect(federation.federateAll).toHaveBeenCalledWith(null);
    expect(result?.outcomes.map((outcome) => outcome.systemCode)).toEqual(['ATLAS_BACKEND', 'DECISION_ENGINE', 'ERP_BACKEND']);
    expect(transaction.rollback).toHaveBeenCalled();
  });

  it('si otra réplica tiene el candado, no hace nada', async () => {
    const { service, federation, catalogRepository, transaction } = build({ lockAcquired: false });

    await expect(service.run('prueba')).resolves.toBeNull();
    expect(federation.federateAll).not.toHaveBeenCalled();
    expect(catalogRepository.upsertEndpoint).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalled();
  });

  it('nunca lanza: un fallo de la federación se traga y devuelve null', async () => {
    const { service, federation } = build();
    federation.federateAll.mockRejectedValueOnce(new Error('boom'));
    await expect(service.run('prueba')).resolves.toBeNull();
  });

  it('dos llamadas simultáneas comparten la misma pasada', async () => {
    const { service, federation } = build();
    const [first, second] = await Promise.all([service.run('a'), service.run('b')]);
    expect(first).toBe(second);
    expect(federation.federateAll).toHaveBeenCalledTimes(1);
  });
});

describe('SystemsCatalogAutoSyncService · arranque', () => {
  const original = {
    APP_ROLE: env.APP_ROLE,
    SYSTEMS_CATALOG_AUTO_SYNC_ENABLED: env.SYSTEMS_CATALOG_AUTO_SYNC_ENABLED,
    SYSTEMS_CATALOG_AUTO_SYNC_INITIAL_DELAY_MS: env.SYSTEMS_CATALOG_AUTO_SYNC_INITIAL_DELAY_MS,
  };
  const mutableEnv = env as unknown as Record<string, unknown>;
  afterEach(async () => {
    Object.assign(mutableEnv, original);
    jest.useRealTimers();
  });

  it('no arranca en el worker, que no tiene contrato de rutas', async () => {
    Object.assign(mutableEnv, { APP_ROLE: 'worker', SYSTEMS_CATALOG_AUTO_SYNC_ENABLED: true });
    jest.useFakeTimers();
    const { service, federation } = build();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(federation.federateAll).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('no arranca si está desactivada', async () => {
    Object.assign(mutableEnv, { APP_ROLE: 'api', SYSTEMS_CATALOG_AUTO_SYNC_ENABLED: false });
    jest.useFakeTimers();
    const { service, federation } = build();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(federation.federateAll).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('en la API corre sola tras el retraso inicial, sin que nadie pulse nada', async () => {
    Object.assign(mutableEnv, {
      APP_ROLE: 'api',
      SYSTEMS_CATALOG_AUTO_SYNC_ENABLED: true,
      SYSTEMS_CATALOG_AUTO_SYNC_INITIAL_DELAY_MS: 1_000,
    });
    jest.useFakeTimers();
    const { service, federation } = build();
    service.onApplicationBootstrap();
    expect(federation.federateAll).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(federation.federateAll).toHaveBeenCalledWith(null);
    await service.onModuleDestroy();
  });
});

describe('structuralFromSeed', () => {
  it('lleva la forma de la ruta y su contrato, nunca los campos de gobierno', () => {
    const [seed] = new OpenApiCatalogService(
      new OpenApiDocumentRegistry(),
      {} as never,
      {
        riskLevelForEndpoint: () => 'HIGH',
        containsPiiForEndpoint: () => true,
      } as never,
    ).buildSeeds(DOCUMENT);

    const structural = structuralFromSeed(seed!, new Date('2026-09-28T00:00:00Z'));

    expect(structural).toMatchObject({ method: seed!.method, fullPath: seed!.fullPath, detectedFrom: 'openapi_contract' });
    for (const governed of ['businessPurpose', 'riskLevel', 'reviewStatus', 'ownerTeam', 'containsPii', 'status', 'confidenceLevel']) {
      expect(structural).not.toHaveProperty(governed);
    }
  });
});
