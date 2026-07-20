import { describe, expect, it, jest } from '@jest/globals';
import { SystemsToolInferenceRepository } from '../../../src/modules/systems-ops/systems-tool-inference.repository.js';

/**
 * Cobertura directa de `SystemsToolInferenceRepository` (Fase 1.2 del plan 10/10): listados de
 * endpoints/tools y el upsert de requisito endpoint↔tool, cuyos flags derivados dependen del estado
 * de la tool (PLANNED) y de la criticidad. Modelos Sequelize mockeados.
 */
describe('SystemsToolInferenceRepository', () => {
  function buildRepo() {
    const endpointModel = { findAll: jest.fn() };
    const toolModel = { findAll: jest.fn() };
    const requirementModel = { upsert: jest.fn() };
    const repo = new SystemsToolInferenceRepository(endpointModel as never, toolModel as never, requirementModel as never);
    return { repo, endpointModel, toolModel, requirementModel };
  }

  it('listActiveEndpoints filtra por status ACTIVE', async () => {
    const { repo, endpointModel } = buildRepo();
    (endpointModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listActiveEndpoints();
    expect((endpointModel.findAll as jest.Mock).mock.calls[0][0].where).toEqual({ status: 'ACTIVE' });
  });

  it('upsertRequirement: tool PLANNED + ambos críticos ⇒ fallback, requiresMock y confidence HIGH', async () => {
    const { repo, requirementModel } = buildRepo();
    (requirementModel.upsert as jest.Mock).mockResolvedValue([{ id: 'req1' }] as never);
    const endpoint = { id: 5, requiresStressTest: true, riskLevel: 'CRITICAL' } as never;
    const tool = { id: 9, status: 'PLANNED', isCritical: true } as never;
    await repo.upsertRequirement(endpoint, tool, {
      usageType: 'call',
      failureImpact: 'high',
      isRequired: true,
      requiresMock: false,
      notes: 'n',
    });
    const arg = (requirementModel.upsert as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(arg.fallbackStrategy).not.toBeNull();
    expect(arg.requiresMock).toBe(true); // false || PLANNED
    expect(arg.requiresStressTest).toBe(true); // requiresStressTest && isCritical
    expect(arg.confidenceLevel).toBe('HIGH');
    expect(arg).toMatchObject({ endpointId: '5', toolId: '9', reviewStatus: 'NEEDS_REVIEW' });
  });

  it('upsertRequirement: tool no PLANNED + no crítica ⇒ fallback null y confidence MEDIUM', async () => {
    const { repo, requirementModel } = buildRepo();
    (requirementModel.upsert as jest.Mock).mockResolvedValue([{ id: 'req2' }] as never);
    const endpoint = { id: 5, requiresStressTest: true, riskLevel: 'LOW' } as never;
    const tool = { id: 9, status: 'ACTIVE', isCritical: false } as never;
    await repo.upsertRequirement(endpoint, tool, {
      usageType: 'call',
      failureImpact: 'low',
      isRequired: false,
      requiresMock: false,
      notes: 'n',
    });
    const arg = (requirementModel.upsert as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(arg.fallbackStrategy).toBeNull();
    expect(arg.requiresMock).toBe(false);
    expect(arg.requiresStressTest).toBe(false);
    expect(arg.confidenceLevel).toBe('MEDIUM');
  });
});
