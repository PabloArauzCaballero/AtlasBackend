import { buildFlowGraph, buildModuleGraph } from '../../src/modules/systems-ops/system-flows.graph.util.js';

const flow = (over: Record<string, unknown> = {}) =>
  ({
    flowId: 'flow_000000000001',
    name: 'Create application (POST /credit/applications)',
    systemCode: 'ATLAS_BACKEND',
    module: 'credit',
    httpMethod: 'POST',
    path: 'credit/applications',
    controller: 'CreditController',
    handler: 'createApplication',
    isPublic: false,
    roles: ['customer'],
    internalPermissions: [],
    guards: [],
    callers: ['CONSUMER_APP'],
    risk: 'CRITICAL',
    kind: 'CREATE',
    testStatus: 'UNTESTED',
    contractStatus: 'IN_CONTRACT',
    findingsCount: 0,
    ...over,
  }) as unknown as Parameters<typeof buildFlowGraph>[0];

describe('buildFlowGraph', () => {
  it('arma la cadena cliente → endpoint → autorización → handler → controller → UNKNOWN, con el rol que concede', () => {
    const graph = buildFlowGraph(flow());
    expect(graph.nodes.map((n) => n.type).sort()).toEqual(['ACTOR', 'CLIENT', 'CONTROLLER', 'ENDPOINT', 'GUARD', 'HANDLER', 'UNKNOWN']);
    expect(graph.edges.map((e) => e.relation).sort()).toEqual(['AUTHORIZES', 'BELONGS_TO', 'CALLS', 'CONTINUES', 'GRANTS', 'HANDLED_BY']);
    expect(graph.stats).toEqual({ nodes: 7, edges: 6, flows: 1, unknown: 1 });
  });
  it('el hueco hacia service y tablas es explícito y con confianza baja: nunca se pinta como hecho', () => {
    const graph = buildFlowGraph(flow());
    const gap = graph.edges.find((e) => e.relation === 'CONTINUES');
    expect(gap?.confidence).toBe(40);
    expect(graph.nodes.find((n) => n.type === 'UNKNOWN')?.meta).toEqual({ reason: 'NOT_ANALYZED_YET' });
    expect(graph.edges.filter((e) => e.relation !== 'CONTINUES').every((e) => e.confidence === 95)).toBe(true);
  });
  it('etiqueta la capa de autorización según la que aplica', () => {
    expect(buildFlowGraph(flow({ isPublic: true, roles: [] })).nodes.find((n) => n.type === 'GUARD')?.label).toBe('Pública');
    expect(buildFlowGraph(flow({ internalPermissions: ['loans.write'] })).nodes.find((n) => n.type === 'GUARD')?.label).toBe(
      'Permiso interno',
    );
    expect(buildFlowGraph(flow({ roles: [] })).nodes.find((n) => n.type === 'GUARD')?.label).toBe('Sólo JWT');
  });
});

describe('buildModuleGraph', () => {
  it('comparte clientes y controllers entre flujos y omite roles por defecto', () => {
    const graph = buildModuleGraph([
      flow(),
      flow({ flowId: 'flow_000000000002', path: 'credit/applications/:p', httpMethod: 'GET', handler: 'getApplication' }),
    ]);
    expect(graph.nodes.filter((n) => n.type === 'CLIENT')).toHaveLength(1);
    expect(graph.nodes.filter((n) => n.type === 'CONTROLLER')).toHaveLength(1);
    expect(graph.nodes.filter((n) => n.type === 'ACTOR')).toHaveLength(0);
    expect(graph.stats.flows).toBe(2);
    expect(graph.stats.unknown).toBe(2);
  });
  it('es determinista: mismo orden de nodos y aristas con la misma entrada', () => {
    const a = buildModuleGraph([flow(), flow({ flowId: 'flow_000000000002' })]);
    const b = buildModuleGraph([flow({ flowId: 'flow_000000000002' }), flow()]);
    expect(a).toEqual(b);
  });
});
