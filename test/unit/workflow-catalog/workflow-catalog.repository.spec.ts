import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { WorkflowCatalogRepository } from '../../../src/modules/workflow-catalog/workflow-catalog.repository.js';
import { buildDefinition, buildStage, buildStep } from './workflow-bundle.fixtures.js';

type FindAllMock = jest.Mock<(options?: unknown) => Promise<unknown[]>>;

function buildRepository(overrides: Record<string, unknown> = {}) {
  const definitionModel = { findAll: jest.fn(async () => []) as FindAllMock, findOne: jest.fn(async () => null) };
  const stageModel = { findAll: jest.fn(async () => []) as FindAllMock };
  const stepModel = { findAll: jest.fn(async () => []) as FindAllMock };
  const dependencyModel = { findAll: jest.fn(async () => []) as FindAllMock };
  const transitionModel = { findAll: jest.fn(async () => []) as FindAllMock };
  Object.assign(definitionModel, overrides.definitionModel ?? {});
  Object.assign(stageModel, overrides.stageModel ?? {});
  Object.assign(stepModel, overrides.stepModel ?? {});
  return {
    repository: new WorkflowCatalogRepository(
      definitionModel as never,
      stageModel as never,
      stepModel as never,
      dependencyModel as never,
      transitionModel as never,
    ),
    definitionModel,
    stageModel,
    stepModel,
    dependencyModel,
    transitionModel,
  };
}

describe('WorkflowCatalogRepository.findDefinitions', () => {
  it('excluye las versiones retiradas salvo que se pidan explícitamente', async () => {
    const { repository, definitionModel } = buildRepository();

    await repository.findDefinitions({ includeDeprecated: false });

    const where = (definitionModel.findAll.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ deleted: false, status: { [Op.ne]: 'deprecated' } });
  });

  it('no impone filtro de estado cuando se piden también las retiradas', async () => {
    const { repository, definitionModel } = buildRepository();

    await repository.findDefinitions({ includeDeprecated: true });

    const where = (definitionModel.findAll.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.status).toBeUndefined();
  });

  it('un estado explícito manda sobre includeDeprecated', async () => {
    const { repository, definitionModel } = buildRepository();

    await repository.findDefinitions({ status: 'deprecated', includeDeprecated: false });

    const where = (definitionModel.findAll.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.status).toBe('deprecated');
  });
});

describe('WorkflowCatalogRepository.findDefinition', () => {
  it('consulta por versión exacta cuando no se pide latest', async () => {
    const { repository, definitionModel } = buildRepository();

    await repository.findDefinition('demo_flow', 'v2');

    expect(definitionModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workflowCode: 'demo_flow', version: 'v2', deleted: false } }),
    );
  });

  it('latest prefiere la versión marcada como predeterminada, no la más nueva', async () => {
    const { repository } = buildRepository({
      definitionModel: {
        findAll: jest.fn(async () => [
          buildDefinition({ version: 'v3', status: 'draft', isDefault: false }),
          buildDefinition({ version: 'v2', status: 'active', isDefault: true }),
        ]),
      },
    });

    const found = await repository.findDefinition('demo_flow', 'latest');

    expect(found?.version).toBe('v2');
  });

  it('latest cae en la activa más reciente si ninguna versión es la predeterminada', async () => {
    const { repository } = buildRepository({
      definitionModel: {
        findAll: jest.fn(async () => [
          buildDefinition({ version: 'v3', status: 'draft', isDefault: false }),
          buildDefinition({ version: 'v2', status: 'active', isDefault: false }),
        ]),
      },
    });

    expect((await repository.findDefinition('demo_flow', 'latest'))?.version).toBe('v2');
  });

  it('latest devuelve null cuando el código no existe', async () => {
    const { repository } = buildRepository({ definitionModel: { findAll: jest.fn(async () => []) } });

    expect(await repository.findDefinition('inexistente', 'latest')).toBeNull();
  });
});

describe('WorkflowCatalogRepository.loadBundle', () => {
  it('lee etapas, pasos, dependencias y transiciones de la definición dada', async () => {
    const definition = buildDefinition({ id: '42' });
    const { repository, stageModel, stepModel } = buildRepository();

    const bundle = await repository.loadBundle(definition);

    expect(bundle.definition).toBe(definition);
    for (const model of [stageModel, stepModel]) {
      expect((model.findAll.mock.calls[0][0] as { where: Record<string, unknown> }).where).toMatchObject({
        workflowDefinitionId: '42',
        deleted: false,
      });
    }
  });
});

describe('WorkflowCatalogRepository.findFacetsByDefinition', () => {
  it('no consulta nada cuando la lista de definiciones viene vacía', async () => {
    const { repository, stageModel } = buildRepository();

    expect((await repository.findFacetsByDefinition([])).size).toBe(0);
    expect(stageModel.findAll).not.toHaveBeenCalled();
  });

  it('agrega módulos de las etapas y roles de etapas y pasos por definición', async () => {
    const { repository } = buildRepository({
      stageModel: {
        findAll: jest.fn(async () => [
          buildStage({ id: '1', stageCode: 'a', workflowDefinitionId: '7', moduleCode: 'auth', allowedRoles: ['customer'] }),
          buildStage({ id: '2', stageCode: 'b', workflowDefinitionId: '7', moduleCode: 'credit', allowedRoles: [] }),
        ]),
      },
      stepModel: {
        findAll: jest.fn(async () => [buildStep({ id: '3', stepCode: 's', workflowDefinitionId: '7', allowedRoles: ['admin'] })]),
      },
    });

    const facets = await repository.findFacetsByDefinition(['7']);

    expect([...(facets.get('7')?.modules ?? [])].sort()).toEqual(['auth', 'credit']);
    expect([...(facets.get('7')?.roles ?? [])].sort()).toEqual(['admin', 'customer']);
  });
});
