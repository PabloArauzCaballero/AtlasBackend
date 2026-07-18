import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SystemsTestSuiteAdminService } from '../../../src/modules/systems-ops/systems-test-suite-admin.service.js';

/**
 * `SystemsTestSuiteAdminService` es el CRUD de suites/pasos de test con guardas de seguridad para
 * producción (una suite marcada "safe" solo admite métodos de lectura y paths no mutantes) y traducción
 * de errores de unicidad a Conflict. Spec directo con el repo mockeado.
 */
describe('SystemsTestSuiteAdminService', () => {
  function build() {
    const repository = {
      createSuite: jest.fn(async () => ({ id: 1, code: 'S1' })),
      findSuiteById: jest.fn(async () => null),
      updateSuite: jest.fn(async () => ({ id: 1, code: 'S1' })),
      findStepsBySuite: jest.fn(async () => [] as unknown[]),
      createStep: jest.fn(async () => ({ id: 10, suiteId: 1, name: 'step' })),
      findStepById: jest.fn(async () => null),
      updateStep: jest.fn(async () => ({ id: 10, suiteId: 1 })),
      reorderSteps: jest.fn(async () => [] as unknown[]),
      findEndpointById: jest.fn(async () => null),
    };
    const service = new SystemsTestSuiteAdminService(repository as never);
    return { service, repository };
  }

  const user = { role: 'system_admin', tenantId: 't1', internalUserId: 'u1', platformUserId: null } as never;

  it('createSuite rechaza scope PRODUCTION_READONLY sin isSafeForProduction', async () => {
    const { service } = build();
    await expect(
      service.createSuite({ environmentScope: ['PRODUCTION_READONLY'], isSafeForProduction: false } as never, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createSuite (feliz) crea la suite y devuelve steps vacíos', async () => {
    const { service } = build();
    const res = await service.createSuite({ environmentScope: ['TEST'], isSafeForProduction: false } as never, user);
    expect(res).toMatchObject({ suite: { suiteId: '1', code: 'S1' }, steps: [] });
  });

  it('createSuite traduce un error de unicidad a Conflict', async () => {
    const { service, repository } = build();
    (repository.createSuite as jest.Mock).mockRejectedValueOnce(new Error('duplicate key value violates unique constraint') as never);
    await expect(service.createSuite({ environmentScope: ['TEST'], isSafeForProduction: false } as never, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('createSuite traduce un error genérico a BadRequest', async () => {
    const { service, repository } = build();
    (repository.createSuite as jest.Mock).mockRejectedValueOnce(new Error('boom') as never);
    await expect(service.createSuite({ environmentScope: ['TEST'], isSafeForProduction: false } as never, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('updateSuite lanza NotFound si la suite no existe', async () => {
    const { service } = build();
    await expect(service.updateSuite('1', {} as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createStep lanza NotFound si la suite no existe', async () => {
    const { service } = build();
    await expect(service.createStep('1', { method: 'GET', pathTemplate: '/x' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createStep rechaza un endpointId que no está en el catálogo', async () => {
    const { service, repository } = build();
    (repository.findSuiteById as jest.Mock).mockResolvedValueOnce({ id: 1, isSafeForProduction: false } as never);
    await expect(service.createStep('1', { method: 'GET', pathTemplate: '/x', endpointId: '99' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('createStep en suite "safe" rechaza métodos de escritura', async () => {
    const { service, repository } = build();
    (repository.findSuiteById as jest.Mock).mockResolvedValueOnce({ id: 1, isSafeForProduction: true } as never);
    await expect(service.createStep('1', { method: 'POST', pathTemplate: '/x' } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createStep en suite "safe" rechaza paths que parecen mutantes', async () => {
    const { service, repository } = build();
    (repository.findSuiteById as jest.Mock).mockResolvedValueOnce({ id: 1, isSafeForProduction: true } as never);
    await expect(service.createStep('1', { method: 'GET', pathTemplate: '/users/delete' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('createStep (feliz) en suite "safe" con GET a path de lectura', async () => {
    const { service, repository } = build();
    (repository.findSuiteById as jest.Mock).mockResolvedValueOnce({ id: 1, isSafeForProduction: true } as never);
    const res = await service.createStep('1', { method: 'GET', pathTemplate: '/users/list' } as never);
    expect(res).toMatchObject({ stepId: '10' });
  });

  it('updateStep lanza NotFound si el step no pertenece a la suite', async () => {
    const { service, repository } = build();
    (repository.findSuiteById as jest.Mock).mockResolvedValueOnce({ id: 1, isSafeForProduction: false } as never);
    (repository.findStepById as jest.Mock).mockResolvedValueOnce({ id: 10, suiteId: 99 } as never);
    await expect(service.updateStep('1', '10', {} as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reorderSteps: NotFound sin suite y BadRequest si el repo reporta orden duplicado', async () => {
    const { service, repository } = build();
    await expect(service.reorderSteps('1', {} as never)).rejects.toBeInstanceOf(NotFoundException);

    (repository.findSuiteById as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
    (repository.reorderSteps as jest.Mock).mockRejectedValueOnce(new Error('SYSTEM_TEST_STEP_DUPLICATED_ORDER') as never);
    await expect(service.reorderSteps('1', {} as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});
