import { describe, expect, it, jest } from '@jest/globals';
import { CatalogManagementController } from '../../../src/modules/catalog-management/catalog-management.controller.js';
import { tenantIdFromHeader, userAgentFrom } from '../../../src/common/utils/http/headers.util.js';

/**
 * `CatalogManagementController` delega en `CatalogManagementService`: las lecturas con { query/params,
 * currentUser } y las mutaciones con un `context` (tenant+IP+user-agent+idempotencyKey) tras exigir
 * x-idempotency-key. Spec directo representativo con el servicio mockeado.
 */
describe('CatalogManagementController', () => {
  function build() {
    const service = {
      listCatalogs: jest.fn(async () => ({ items: [] })),
      getCatalogVersion: jest.fn(async () => ({ version: {} })),
      listDefinitions: jest.fn(async () => ({ definitions: {} })),
      getCurrentRiskPolicy: jest.fn(async () => ({ ruleset: {} })),
      getDataGovernancePolicies: jest.fn(async () => ({ policies: {} })),
      createCatalogVersion: jest.fn(async () => ({ versionId: 'v1' })),
      decideCatalogVersion: jest.fn(async () => ({ decided: true })),
    };
    return { controller: new CatalogManagementController(service as never), service };
  }
  const user = { role: 'risk_analyst', tenantId: '1', internalUserId: 'u1' } as never;
  const request = { ip: '3.3.3.3', headers: { 'user-agent': 'jest-ua' } } as never;
  const expectedContext = { tenantId: tenantIdFromHeader('1'), ipAddress: '3.3.3.3', userAgent: userAgentFrom(request), idempotencyKey: 'idem' };

  it('las lecturas delegan con { query/params, currentUser }', async () => {
    const { controller, service } = build();
    await controller.listCatalogs({ domain: 'risk' } as never, user);
    await controller.getCatalogVersion({ catalogCode: 'C', versionId: 'v1' } as never, user);
    await controller.listDefinitions({ type: 'event' } as never, user);
    await controller.getCurrentRiskPolicy(user);
    await controller.getDataGovernancePolicies(user);
    expect(service.listCatalogs).toHaveBeenCalledWith({ query: { domain: 'risk' }, currentUser: user });
    expect(service.getCatalogVersion).toHaveBeenCalledWith({ catalogCode: 'C', versionId: 'v1', currentUser: user });
    expect(service.listDefinitions).toHaveBeenCalledWith({ query: { type: 'event' }, currentUser: user });
    expect(service.getCurrentRiskPolicy).toHaveBeenCalledWith({ currentUser: user });
    expect(service.getDataGovernancePolicies).toHaveBeenCalledWith({ currentUser: user });
  });

  it('createCatalogVersion delega con el context y exige x-idempotency-key', async () => {
    const { controller, service } = build();
    const body = { versionCode: 'v2' } as never;
    await controller.createCatalogVersion('1', 'idem', { catalogCode: 'C' } as never, body, user, request);
    expect(service.createCatalogVersion).toHaveBeenCalledWith({ catalogCode: 'C', body, currentUser: user, context: expectedContext });
    expect(() => controller.createCatalogVersion('1', undefined, { catalogCode: 'C' } as never, body, user, request)).toThrow();
  });

  it('decideCatalogVersion delega con el context', async () => {
    const { controller, service } = build();
    const body = { decision: 'approved' } as never;
    await controller.decideCatalogVersion('1', 'idem', { catalogCode: 'C', versionId: 'v1' } as never, body, user, request);
    expect(service.decideCatalogVersion).toHaveBeenCalledWith({ catalogCode: 'C', versionId: 'v1', body, currentUser: user, context: expectedContext });
  });
});
