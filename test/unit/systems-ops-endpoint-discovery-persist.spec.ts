import { describe, expect, it, jest } from '@jest/globals';
import { EndpointDiscoveryService, DiscoveredEndpoint } from '../../src/modules/systems-ops/endpoint-discovery.service.js';

/**
 * `discoverAndMaybePersist` solía hacer `for (const item of items) await upsertEndpoint(item)` —
 * un round trip 100% secuencial por endpoint descubierto. Ahora dispara los upserts en lotes de
 * concurrencia acotada (`Promise.all` por chunk) en vez de uno a la vez, sin cambiar cuántas
 * veces se llama a `upsertEndpoint` ni con qué datos.
 */
function buildItem(index: number): DiscoveredEndpoint {
  return { method: 'GET', fullPath: `/systems/fixture-${index}`, code: `fixture_${index}` } as unknown as DiscoveredEndpoint;
}

function buildService(repository: { upsertEndpoint: jest.Mock; markDeprecatedCandidates: jest.Mock }) {
  const classifier = { riskLevelForEndpoint: () => 'LOW', containsPiiForEndpoint: () => false };
  return new EndpointDiscoveryService(repository as never, classifier as never);
}

describe('EndpointDiscoveryService.discoverAndMaybePersist', () => {
  it('does not persist anything when persist=false', async () => {
    const repository = { upsertEndpoint: jest.fn(), markDeprecatedCandidates: jest.fn() };
    const service = buildService(repository);
    jest.spyOn(service, 'scanControllers').mockResolvedValue([buildItem(1), buildItem(2)]);

    const result = await service.discoverAndMaybePersist(false);

    expect(repository.upsertEndpoint).not.toHaveBeenCalled();
    expect(repository.markDeprecatedCandidates).not.toHaveBeenCalled();
    expect(result).toMatchObject({ discovered: 2, persisted: 0, deprecatedCandidates: 0 });
  });

  it('upserts every discovered item exactly once, even across a batch boundary (25 items, chunks of 10)', async () => {
    const repository = { upsertEndpoint: jest.fn(async () => undefined), markDeprecatedCandidates: jest.fn(async () => 3) };
    const service = buildService(repository);
    const items = Array.from({ length: 25 }, (_, i) => buildItem(i));
    jest.spyOn(service, 'scanControllers').mockResolvedValue(items);

    const result = await service.discoverAndMaybePersist(true);

    expect(repository.upsertEndpoint).toHaveBeenCalledTimes(25);
    for (const item of items) {
      expect(repository.upsertEndpoint).toHaveBeenCalledWith(item);
    }
    expect(result).toMatchObject({ discovered: 25, persisted: 25, deprecatedCandidates: 3 });
  });

  it('still runs markDeprecatedCandidates with the full set of active method+path keys after chunked persistence', async () => {
    const repository = { upsertEndpoint: jest.fn(async () => undefined), markDeprecatedCandidates: jest.fn(async () => 0) };
    const service = buildService(repository);
    const items = [buildItem(1), buildItem(2)];
    jest.spyOn(service, 'scanControllers').mockResolvedValue(items);

    await service.discoverAndMaybePersist(true);

    expect(repository.markDeprecatedCandidates).toHaveBeenCalledWith(new Set(['GET /systems/fixture-1', 'GET /systems/fixture-2']));
  });
});
