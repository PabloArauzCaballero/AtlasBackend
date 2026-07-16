import { ForbiddenException } from '@nestjs/common';
import { SystemsTestRunnerService } from '../../src/modules/systems-ops/systems-test-runner.service.js';
import { SystemsTestAssertionService } from '../../src/modules/systems-ops/systems-test-assertion.service.js';
import { SystemsTestTemplateService } from '../../src/modules/systems-ops/systems-test-template.service.js';

/**
 * `assertRealRunCanExecute` bloquea SSRF para runs reales fuera de LOCAL. Este test cubre el
 * bloqueo agregado, sin necesidad de una base de datos real (repositorio y http client mockeados).
 */
describe('SystemsTestRunnerService — SSRF guard on real (non-dry-run) executions', () => {
  function buildService(overrides: { httpExecute?: jest.Mock } = {}) {
    const suite = { id: 's1', isEnabled: true, environmentScope: ['LOCAL', 'STAGING', 'PRODUCTION_READONLY'], isSafeForProduction: true };
    const repository = {
      findTestSuiteById: jest.fn(async () => suite),
      findTestStepsBySuite: jest.fn(async () => []),
      createTestRun: jest.fn(async (values: Record<string, unknown>) => ({ id: 'run-1', ...values })),
      finishTestRun: jest.fn(async (_run: unknown, values: Record<string, unknown>) => ({ id: 'run-1', ...values })),
      createTestStepRun: jest.fn(async () => ({})),
      findStepRunsByRun: jest.fn(async () => []),
    };
    const assertions = new SystemsTestAssertionService();
    const httpClient = { execute: overrides.httpExecute ?? jest.fn() };
    const templates = new SystemsTestTemplateService();
    const service = new SystemsTestRunnerService(repository as never, assertions, httpClient as never, templates);
    return { service, repository, httpClient };
  }

  const user = { role: 'system_admin', internalUserId: 'iu1' } as never;

  it.each([
    ['STAGING', 'http://169.254.169.254/latest/meta-data/'],
    ['STAGING', 'http://10.0.0.5/internal-admin'],
    ['STAGING', 'http://192.168.1.1/'],
    ['PRODUCTION_READONLY', 'http://169.254.169.254/'],
    ['STAGING', 'http://127.0.0.1:9999/'],
  ])(
    'blocks a real run targeting an internal/metadata address (%s, %s) instead of issuing the HTTP request',
    async (environment, baseUrl) => {
      const { service, httpClient } = buildService();

      await expect(
        service.runSuite('s1', { environment, dryRun: false, baseUrl, config: {}, headers: {}, timeoutMs: 5000 } as never, user),
      ).rejects.toThrow(ForbiddenException);

      expect(httpClient.execute).not.toHaveBeenCalled();
    },
  );

  it('still allows a real run against a legitimate external staging host', async () => {
    const httpExecute = jest.fn(async () => ({ statusCode: 200, responseBody: { ok: true }, errorMessage: null }));
    const { service, repository } = buildService({ httpExecute });
    (repository.findTestStepsBySuite as jest.Mock).mockResolvedValueOnce([
      {
        id: 'step-1',
        method: 'GET',
        pathTemplate: '/health',
        defaultHeaders: {},
        defaultPayload: {},
        configSchema: {},
        extractors: {},
        assertions: {},
        continueOnFailure: false,
        inputMode: 'FIXED',
      },
    ] as never);

    const result = await service.runSuite(
      's1',
      {
        environment: 'STAGING',
        dryRun: false,
        baseUrl: 'https://staging.atlas.example.com',
        config: {},
        headers: {},
        timeoutMs: 5000,
      } as never,
      user,
    );

    expect(httpExecute).toHaveBeenCalledTimes(1);
    expect(result.run.status).toBe('PASSED');
  });
});
