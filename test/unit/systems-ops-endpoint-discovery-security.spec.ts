import { EndpointDiscoveryService } from '../../src/modules/systems-ops/endpoint-discovery.service.js';

describe('EndpointDiscoveryService security metadata', () => {
  it('distingue métodos públicos y protegidos dentro del mismo controller', async () => {
    const classifier = {
      riskLevelForEndpoint: () => 'LOW',
      containsPiiForEndpoint: () => false,
    };
    const service = new EndpointDiscoveryService({} as never, classifier as never);
    const endpoints = await service.scanControllers();
    const login = endpoints.find((endpoint) => endpoint.fullPath === '/api/v1/auth/login');
    const provision = endpoints.find((endpoint) => endpoint.fullPath === '/api/v1/auth/provision-credentials');

    expect(login?.requiresAuth).toBe(false);
    expect(provision?.requiresAuth).toBe(true);
    expect(provision?.allowedRoles).toEqual(expect.arrayContaining(['admin', 'platform_admin']));
  });

  it('resuelve conjuntos reales de roles de Systems Ops', async () => {
    const classifier = { riskLevelForEndpoint: () => 'LOW', containsPiiForEndpoint: () => false };
    const service = new EndpointDiscoveryService({} as never, classifier as never);
    const endpoints = await service.scanControllers();
    const runSuite = endpoints.find((endpoint) => endpoint.fullPath === '/api/v1/systems/test-suites/:suiteId/run');

    expect(runSuite?.allowedRoles).toEqual(['system_admin', 'platform_admin', 'qa_engineer']);
  });
});
