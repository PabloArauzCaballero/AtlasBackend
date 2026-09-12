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
    expect(graph.nodes.find((n) => n.type === 'UNKNOWN')?.meta).toEqual({ reasons: ['NOT_ANALYZED_YET'] });
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

describe('buildFlowGraph con análisis (fase 2)', () => {
  const analyzed = flow({
    analysisJson: {
      status: 'PARTIAL',
      chain: [
        { kind: 'SERVICE', class: 'CreditService', method: 'create', file: 'src/modules/credit/credit.service.ts', line: 40, depth: 0 },
        {
          kind: 'REPOSITORY',
          class: 'CreditRepository',
          method: 'insert',
          file: 'src/modules/credit/credit.repository.ts',
          line: 12,
          depth: 1,
        },
        {
          kind: 'REPOSITORY',
          class: 'CreditRepository',
          method: 'find',
          file: 'src/modules/credit/credit.repository.ts',
          line: 30,
          depth: 1,
        },
      ],
      reads: ['customers'],
      writes: [{ table: 'credit_applications', op: 'INSERT', via: 'SEQUELIZE' }],
      errors: ['ConflictException'],
      blockCalls: [{ target: '/v1/decisions', at: 'src/modules/credit/credit.service.ts:77' }],
      unknowns: [{ reason: 'RAW_SQL_DYNAMIC', at: 'src/modules/credit/credit.repository.ts:50' }],
      transactional: true,
    },
  });
  it('sustituye el hueco por services, tablas, errores y salidas, y deja un UNKNOWN sólo por lo no resuelto', () => {
    const graph = buildFlowGraph(analyzed);
    const types = graph.nodes.map((n) => n.type);
    expect(types.filter((t) => t === 'SERVICE')).toHaveLength(1);
    expect(types.filter((t) => t === 'REPOSITORY')).toHaveLength(1);
    expect(types.filter((t) => t === 'DATABASE')).toHaveLength(2);
    expect(types).toContain('ERROR');
    expect(types).toContain('BLOCK_CALL');
    expect(graph.nodes.find((n) => n.type === 'UNKNOWN')?.sublabel).toBe('RAW_SQL_DYNAMIC');
    expect(graph.edges.find((e) => e.relation === 'WRITES')?.label).toBe('INSERT');
    expect(graph.edges.filter((e) => e.evidence.includes('STATIC_AST_DIRECT')).every((e) => e.confidence === 75)).toBe(true);
    expect(graph.nodes.find((n) => n.type === 'HANDLER')?.meta?.transactional).toBe(true);
  });
  it('un análisis con forma vieja o inválida se ignora y vuelve al hueco declarado', () => {
    const graph = buildFlowGraph(flow({ analysisJson: { status: 'MAPPED', chain: 'no-es-lista' } }));
    expect(graph.nodes.find((n) => n.type === 'UNKNOWN')?.meta).toEqual({ reasons: ['NOT_ANALYZED_YET'] });
  });
});
