import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { WorkflowCatalogService } from '../../../src/modules/workflow-catalog/workflow-catalog.service.js';
import { buildBundle, buildDefinition } from './workflow-bundle.fixtures.js';

function buildService(overrides: Record<string, unknown> = {}) {
  const bundle = buildBundle();
  const repository = {
    findDefinitions: jest.fn(async () => [bundle.definition]),
    findVersions: jest.fn(async () => [bundle.definition]),
    findDefinition: jest.fn(async () => bundle.definition),
    loadBundle: jest.fn(async () => bundle),
    findFacetsByDefinition: jest.fn(async () => new Map()),
    ...overrides,
  };
  return { service: new WorkflowCatalogService(repository as never), repository, bundle };
}

const TREE_QUERY = { version: 'latest' as const };

describe('WorkflowCatalogService.listWorkflows', () => {
  it('no consulta las facetas cuando no hay filtros por módulo ni por rol', async () => {
    const { service, repository } = buildService();

    const result = await service.listWorkflows({ version: 'latest', includeDeprecated: false } as never);

    expect(result).toHaveLength(1);
    expect(repository.findFacetsByDefinition).not.toHaveBeenCalled();
  });

  it('descarta los flujos cuyo conjunto de módulos no incluye el pedido', async () => {
    const { service } = buildService({
      findFacetsByDefinition: jest.fn(async () => new Map([['1', { modules: new Set(['auth']), roles: new Set(['customer']) }]])),
    });

    expect(await service.listWorkflows({ moduleCode: 'credit', includeDeprecated: false } as never)).toHaveLength(0);
    expect(await service.listWorkflows({ moduleCode: 'auth', includeDeprecated: false } as never)).toHaveLength(1);
  });

  it('mantiene visible un flujo que no declara ningún rol al filtrar por rol', async () => {
    // Un flujo cuyos pasos solo exigen autenticación no debe esconderse: filtrarlo dejaría al
    // consumidor sin el recorrido entero por una ausencia de metadatos, no por una restricción.
    const { service } = buildService({
      findFacetsByDefinition: jest.fn(async () => new Map([['1', { modules: new Set(['auth']), roles: new Set<string>() }]])),
    });

    expect(await service.listWorkflows({ role: 'risk_analyst', includeDeprecated: false } as never)).toHaveLength(1);
  });

  it('descarta los flujos cuyos roles declarados no incluyen el pedido', async () => {
    const { service } = buildService({
      findFacetsByDefinition: jest.fn(async () => new Map([['1', { modules: new Set(['auth']), roles: new Set(['customer']) }]])),
    });

    expect(await service.listWorkflows({ role: 'devops', includeDeprecated: false } as never)).toHaveLength(0);
  });
});

describe('WorkflowCatalogService.listVersions', () => {
  it('devuelve 404 cuando el código no tiene ninguna versión registrada', async () => {
    const { service } = buildService({ findVersions: jest.fn(async () => []) });

    await expect(service.listVersions('inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devuelve el resumen de cada versión registrada', async () => {
    const { service } = buildService({
      findVersions: jest.fn(async () => [buildDefinition({ version: 'v2' }), buildDefinition({ version: 'v1' })]),
    });

    expect((await service.listVersions('demo_flow')).map((row) => row.version)).toEqual(['v2', 'v1']);
  });
});

describe('WorkflowCatalogService lecturas del árbol', () => {
  it('devuelve 404 cuando la versión pedida no existe, en vez de un árbol vacío', async () => {
    const { service } = buildService({ findDefinition: jest.fn(async () => null) });

    await expect(service.getTree('demo_flow', TREE_QUERY as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('aplana las etapas en orden con su profundidad', async () => {
    const { service } = buildService();

    const stages = await service.listStages('demo_flow', TREE_QUERY as never);

    expect(stages.map((stage) => [stage.stageCode, stage.depth])).toEqual([
      ['stage_a', 0],
      ['stage_a_child', 1],
      ['stage_b', 0],
    ]);
  });

  it('aplica el filtro de módulo también en el listado de transiciones', async () => {
    const { service } = buildService();

    const transitions = await service.listTransitions('demo_flow', { version: 'latest', moduleCode: 'operations' } as never);

    expect(transitions.map((transition) => transition.transitionCode)).toEqual(['exit']);
  });

  it('construye el grafo sobre el mismo bundle filtrado que el árbol', async () => {
    const { service } = buildService();

    const graph = await service.getGraph('demo_flow', { version: 'latest', moduleCode: 'operations' } as never);

    expect(graph.nodes.filter((node) => node.type === 'step').map((node) => node.code)).toEqual(['step.three']);
  });

  it('propaga el código y la versión pedidos al repositorio', async () => {
    const { service, repository } = buildService();

    await service.getTree('demo_flow', { version: 'v3' } as never);

    expect(repository.findDefinition).toHaveBeenCalledWith('demo_flow', 'v3');
  });
});
