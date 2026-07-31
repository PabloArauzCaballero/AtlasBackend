import { describe, expect, it } from '@jest/globals';
import { buildWorkflowGraph } from '../../../src/modules/workflow-catalog/workflow-graph.builder.js';
import { buildBundle } from './workflow-bundle.fixtures.js';

describe('buildWorkflowGraph', () => {
  it('emite un nodo por etapa y uno por paso', () => {
    const graph = buildWorkflowGraph(buildBundle());

    expect(graph.nodes.filter((node) => node.type === 'stage')).toHaveLength(3);
    expect(graph.nodes.filter((node) => node.type === 'step')).toHaveLength(3);
  });

  it('prefija los identificadores por tipo para que etapa y paso no colisionen', () => {
    const graph = buildWorkflowGraph(buildBundle());

    // Etapas y pasos tienen secuencias independientes: sin prefijo, `10` sería a la vez una etapa
    // y un paso y el diagrama uniría dos nodos que no se relacionan.
    expect(graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['stage:stage_a', 'step:step.one']));
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
  });

  it('cuelga cada paso de su etapa y cada subetapa de su padre', () => {
    const graph = buildWorkflowGraph(buildBundle());

    expect(graph.nodes.find((node) => node.id === 'stage:stage_a_child')?.parentId).toBe('stage:stage_a');
    expect(graph.nodes.find((node) => node.id === 'step:step.two')?.parentId).toBe('stage:stage_a_child');
  });

  it('etiqueta los nodos de paso con su método y ruta', () => {
    const graph = buildWorkflowGraph(buildBundle());

    const node = graph.nodes.find((candidate) => candidate.id === 'step:step.one');
    expect(node).toMatchObject({ label: 'POST /auth/login', httpMethod: 'POST', routePath: '/auth/login', isEntry: true });
  });

  it('emite una arista por transición, con null en los extremos del flujo', () => {
    const graph = buildWorkflowGraph(buildBundle());

    const entry = graph.edges.find((edge) => edge.id === 'transition:entry');
    expect(entry).toMatchObject({ type: 'transition', source: null, target: 'step:step.one', conditionType: 'always' });
    const exit = graph.edges.find((edge) => edge.id === 'transition:exit');
    expect(exit).toMatchObject({ source: 'step:step.three', target: null });
  });

  it('emite las dependencias como aristas dirigidas del prerrequisito hacia el paso dependiente', () => {
    const graph = buildWorkflowGraph(buildBundle());

    expect(graph.edges.find((edge) => edge.type === 'dependency')).toMatchObject({
      source: 'step:step.two',
      target: 'step:step.three',
      label: 'requires_completion',
    });
  });

  it('omite las dependencias cuyos pasos no están en el bundle filtrado', () => {
    const bundle = buildBundle();
    bundle.steps = bundle.steps.filter((step) => step.stepCode !== 'step.two');

    const graph = buildWorkflowGraph(bundle);

    expect(graph.edges.filter((edge) => edge.type === 'dependency')).toHaveLength(0);
  });

  it('propaga código, versión y estado del flujo en la cabecera del grafo', () => {
    const graph = buildWorkflowGraph(buildBundle());

    expect(graph).toMatchObject({ workflowCode: 'demo_flow', version: 'v1', status: 'active' });
  });
});
