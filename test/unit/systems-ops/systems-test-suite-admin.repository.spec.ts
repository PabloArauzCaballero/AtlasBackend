import { describe, expect, it, jest } from '@jest/globals';
import { SystemsTestSuiteAdminRepository } from '../../../src/modules/systems-ops/systems-test-suite-admin.repository.js';

/**
 * Cobertura directa de `SystemsTestSuiteAdminRepository` (Fase 1.2 del plan 10/10): CRUD de suites/
 * steps con la derivación de requiresDestructivePermission, actualizaciones parciales y el reordenado
 * de steps con sus validaciones (id ajeno, orden duplicado). Modelos Sequelize mockeados.
 */
describe('SystemsTestSuiteAdminRepository', () => {
  function buildRepo() {
    const endpointModel = { findByPk: jest.fn() };
    const suiteModel = { findByPk: jest.fn(), create: jest.fn() };
    const stepModel = { findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn() };
    const repo = new SystemsTestSuiteAdminRepository(endpointModel as never, suiteModel as never, stepModel as never);
    return { repo, endpointModel, suiteModel, stepModel };
  }

  it('createSuite deriva requiresDestructivePermission de !isSafeForProduction cuando no se pasa', async () => {
    const { repo, suiteModel } = buildRepo();
    (suiteModel.create as jest.Mock).mockResolvedValue({ id: 's1' } as never);
    await repo.createSuite(
      { code: 'C', name: 'N', module: 'm', suiteType: 't', environmentScope: ['dev'], isEnabled: true, requiresSeedData: true, isSafeForProduction: false } as never,
      'u1',
    );
    expect((suiteModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ requiresDestructivePermission: true, createdBy: 'u1' });
  });

  it('updateSuite solo toca los campos definidos y deriva destructivePermission de isSafeForProduction', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({}));
    const suite = { code: 'old', name: 'old', save } as never;
    await repo.updateSuite(suite, { name: 'new', isSafeForProduction: true } as never);
    expect((suite as { name: string }).name).toBe('new');
    expect((suite as { code: string }).code).toBe('old'); // no tocado
    expect((suite as { requiresDestructivePermission: boolean }).requiresDestructivePermission).toBe(false); // !isSafeForProduction
    expect(save).toHaveBeenCalled();
  });

  it('updateSuite respeta requiresDestructivePermission explícito sobre isSafeForProduction', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({}));
    const suite = { save } as never;
    await repo.updateSuite(suite, { isSafeForProduction: true, requiresDestructivePermission: true } as never);
    expect((suite as { requiresDestructivePermission: boolean }).requiresDestructivePermission).toBe(true);
  });

  it('createStep mapea endpointId ?? null', async () => {
    const { repo, stepModel } = buildRepo();
    (stepModel.create as jest.Mock).mockResolvedValue({ id: 'st1' } as never);
    await repo.createStep('s1', { stepOrder: 1, name: 'step', method: 'GET', pathTemplate: '/x' } as never);
    expect((stepModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ suiteId: 's1', endpointId: null });
  });

  it('reorderSteps lanza si algún stepId no pertenece a la suite', async () => {
    const { repo, stepModel } = buildRepo();
    (stepModel.findAll as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    await expect(repo.reorderSteps('s1', { steps: [{ stepId: '99', stepOrder: 1 }] } as never)).rejects.toThrow('SYSTEM_TEST_STEP_NOT_IN_SUITE:99');
  });

  it('reorderSteps lanza si hay órdenes duplicados', async () => {
    const { repo, stepModel } = buildRepo();
    (stepModel.findAll as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    await expect(
      repo.reorderSteps('s1', { steps: [{ stepId: '1', stepOrder: 5 }, { stepId: '2', stepOrder: 5 }] } as never),
    ).rejects.toThrow('SYSTEM_TEST_STEP_DUPLICATED_ORDER');
  });

  it('reorderSteps aplica el nuevo stepOrder y guarda cada step', async () => {
    const { repo, stepModel } = buildRepo();
    const save1 = jest.fn(async () => ({}));
    const save2 = jest.fn(async () => ({}));
    const steps = [
      { id: 1, save: save1 },
      { id: 2, save: save2 },
    ];
    (stepModel.findAll as jest.Mock).mockResolvedValue(steps as never);
    await repo.reorderSteps('s1', { steps: [{ stepId: '1', stepOrder: 2 }, { stepId: '2', stepOrder: 1 }] } as never);
    expect((steps[0] as { stepOrder: number }).stepOrder).toBe(2);
    expect((steps[1] as { stepOrder: number }).stepOrder).toBe(1);
    expect(save1).toHaveBeenCalled();
    expect(save2).toHaveBeenCalled();
  });
});
