import { EndpointDiscoveryService } from '../../src/modules/systems-ops/endpoint-discovery.service.js';
import { SYSTEMS_OPS_GOVERNANCE_ROLES } from '../../src/modules/systems-ops/systems-ops.constants.js';

describe('EndpointDiscoveryService security metadata', () => {
  it('distingue métodos públicos y protegidos dentro del mismo controller', async () => {
    const classifier = {
      riskLevelForEndpoint: () => 'LOW',
      containsPiiForEndpoint: () => false,
    };
    const service = new EndpointDiscoveryService({} as never, classifier as never, {} as never);
    const endpoints = await service.scanControllers();
    const login = endpoints.find((endpoint) => endpoint.fullPath === '/api/v1/auth/login');
    const provision = endpoints.find((endpoint) => endpoint.fullPath === '/api/v1/auth/provision-credentials');

    expect(login?.requiresAuth).toBe(false);
    expect(provision?.requiresAuth).toBe(true);
    expect(provision?.allowedRoles).toEqual(expect.arrayContaining(['admin', 'platform_admin']));
  });

  it('resuelve conjuntos reales de roles de Systems Ops', async () => {
    const classifier = { riskLevelForEndpoint: () => 'LOW', containsPiiForEndpoint: () => false };
    const service = new EndpointDiscoveryService({} as never, classifier as never, {} as never);
    const endpoints = await service.scanControllers();
    const runSuite = endpoints.find((endpoint) => endpoint.fullPath === '/api/v1/systems/test-suites/:suiteId/run');

    expect(runSuite?.allowedRoles).toEqual(['system_admin', 'platform_admin', 'qa_engineer']);
  });

  it('cada ruta sin @Roles propio hereda el de la clase, no sólo la primera (como RolesGuard)', async () => {
    const classifier = { riskLevelForEndpoint: () => 'LOW', containsPiiForEndpoint: () => false };
    const service = new EndpointDiscoveryService({} as never, classifier as never, {} as never);
    const endpoints = await service.scanControllers();
    const ruta = (method: string, fullPath: string) =>
      endpoints.find((endpoint) => endpoint.method === method && endpoint.fullPath === fullPath);

    // Primera y última lectura de SystemFlowsController: las dos con los roles de la clase, que incluyen internal_operator.
    expect(ruta('GET', '/api/v1/systems/flows/summary')?.allowedRoles).toContain('internal_operator');
    expect(ruta('GET', '/api/v1/systems/flows/:flowId')?.allowedRoles).toContain('internal_operator');
    // Una escritura con @Roles propio: manda el suyo, aunque la clase declare otros.
    expect(ruta('POST', '/api/v1/systems/flows/import/endpoints')?.allowedRoles).toEqual([...SYSTEMS_OPS_GOVERNANCE_ROLES]);
  });
});
