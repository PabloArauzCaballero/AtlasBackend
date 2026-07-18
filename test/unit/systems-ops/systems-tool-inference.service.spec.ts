import { describe, expect, it, jest } from '@jest/globals';

/**
 * `SystemsToolInferenceService.infer` recorre los endpoints activos, lee su código fuente y deduce
 * qué herramientas usa según patrones regex. Se mockea `readSourcesForEndpoint` (que escanea el disco)
 * para controlar el "código fuente" y ejercitar el matching, el conteo de tools ausentes, el nivel de
 * confianza y el modo persist. Patrón de module-mock ya usado en el repo (prefijo `mock` por el hoisting).
 */
const mockReadSources = jest.fn(async () => '');
jest.mock('../../../src/modules/systems-ops/systems-source-scan.util.js', () => ({
  readSourcesForEndpoint: (endpoint: unknown) => mockReadSources(endpoint),
  clearSourceScanCacheForTests: () => undefined,
}));

describe('SystemsToolInferenceService', () => {
  async function build(tools: unknown[]) {
    const { SystemsToolInferenceService } = await import('../../../src/modules/systems-ops/systems-tool-inference.service.js');
    const repository = {
      listActiveEndpoints: jest.fn(async () => [{ id: 1, code: 'EP', module: 'auth', fullPath: '/api/v1/x', riskLevel: 'LOW' }]),
      listTools: jest.fn(async () => tools),
      upsertRequirement: jest.fn(async () => ({})),
    };
    const service = new SystemsToolInferenceService(repository as never);
    return { service, repository };
  }

  it('sin código fuente no infiere nada (DRY_RUN)', async () => {
    mockReadSources.mockResolvedValueOnce('' as never);
    const { service } = await build([{ code: 'JWT', isCritical: true }]);
    const res = await service.infer({ persist: false });
    expect(res).toMatchObject({ inferred: 0, persisted: 0, skippedMissingTools: 0, reviewStatus: 'DRY_RUN', items: [] });
  });

  it('infiere por patrón en el código y cuenta las tools ausentes del catálogo', async () => {
    mockReadSources.mockResolvedValueOnce('este handler usa JwtAuthGuard para autenticar' as never);
    const { service } = await build([{ code: 'JWT', isCritical: true }]); // solo JWT existe; el resto de patrones -> skipped
    const res = await service.infer({ persist: false });
    expect(res.inferred).toBe(1);
    expect(res.items[0]).toMatchObject({ toolCode: 'JWT', usageType: 'AUTH', confidenceLevel: 'LOW' });
    expect(res.skippedMissingTools).toBeGreaterThan(0);
  });

  it('también matchea contra el fullPath del endpoint cuando el código no basta', async () => {
    mockReadSources.mockResolvedValueOnce('// código sin señales de tools' as never);
    const { SystemsToolInferenceService } = await import('../../../src/modules/systems-ops/systems-tool-inference.service.js');
    const repository = {
      listActiveEndpoints: jest.fn(async () => [{ id: 2, code: 'EP2', module: 'auth', fullPath: '/auth/accessToken/refresh', riskLevel: 'LOW' }]),
      listTools: jest.fn(async () => [{ code: 'JWT', isCritical: true }]),
      upsertRequirement: jest.fn(async () => ({})),
    };
    const service = new SystemsToolInferenceService(repository as never);
    const res = await service.infer({ persist: false });
    expect(res.items.some((item) => item.toolCode === 'JWT')).toBe(true);
  });

  it('confianza HIGH cuando el endpoint es CRITICAL y la tool es crítica', async () => {
    mockReadSources.mockResolvedValueOnce('JwtAuthGuard' as never);
    const { SystemsToolInferenceService } = await import('../../../src/modules/systems-ops/systems-tool-inference.service.js');
    const repository = {
      listActiveEndpoints: jest.fn(async () => [{ id: 3, code: 'EP3', module: 'auth', fullPath: '/x', riskLevel: 'CRITICAL' }]),
      listTools: jest.fn(async () => [{ code: 'JWT', isCritical: true }]),
      upsertRequirement: jest.fn(async () => ({})),
    };
    const service = new SystemsToolInferenceService(repository as never);
    const res = await service.infer({ persist: false });
    expect(res.items[0].confidenceLevel).toBe('HIGH');
  });

  it('con persist:true dispara los upserts y marca NEEDS_REVIEW', async () => {
    mockReadSources.mockResolvedValueOnce('JwtAuthGuard' as never);
    const { service, repository } = await build([{ code: 'JWT', isCritical: true }]);
    const res = await service.infer({ persist: true });
    expect(res.persisted).toBe(1);
    expect(res.reviewStatus).toBe('NEEDS_REVIEW');
    expect(repository.upsertRequirement).toHaveBeenCalledTimes(1);
  });
});
