import { BadRequestException } from '@nestjs/common';
import { SystemsTestSuiteAdminService } from '../../src/modules/systems-ops/systems-test-suite-admin.service.js';

function user() {
  return { sub: 'user-1', roles: ['system_admin'] } as never;
}

describe('SystemsTestSuiteAdminService', () => {
  it('blocks PRODUCTION_READONLY suites unless explicitly marked safe', async () => {
    const repository = { createSuite: jest.fn() } as never;
    const service = new SystemsTestSuiteAdminService(repository);

    await expect(
      service.createSuite(
        {
          code: 'UNSAFE_PROD_SUITE',
          name: 'Unsafe production suite',
          module: 'systems',
          suiteType: 'SMOKE',
          environmentScope: ['PRODUCTION_READONLY'],
          isEnabled: true,
          requiresSeedData: false,
          isSafeForProduction: false,
        },
        user(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks mutating steps inside production-safe suites', async () => {
    const repository = {
      findSuiteById: jest.fn().mockResolvedValue({ id: '1', isSafeForProduction: true }),
      findEndpointById: jest.fn().mockResolvedValue(null),
    } as never;
    const service = new SystemsTestSuiteAdminService(repository);

    await expect(
      service.createStep('1', {
        stepOrder: 1,
        name: 'Run dangerous refresh',
        inputMode: 'DEFAULT',
        method: 'POST',
        pathTemplate: '/api/v1/systems/endpoints/catalog-seed/refresh',
        defaultHeaders: {},
        defaultPayload: {},
        configSchema: {},
        extractors: {},
        assertions: { expectedStatusCodes: [200] },
        continueOnFailure: false,
        cleanupRequired: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
