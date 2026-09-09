/**
 * @file Utilidad de dominio: arma el grafo de Flujos a partir del catálogo derivado, sin mirar la base.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system construye nodos y aristas tipados (cliente → request → endpoint → autorización → handler → ?) por flujo o por módulo.
 */
import { SystemFlowCatalogModel } from '../../database/models/index.js';

export type GraphLayer = 'CLIENT' | 'API' | 'BACKEND' | 'DATA';
export type GraphNodeType = 'ACTOR' | 'CLIENT' | 'ENDPOINT' | 'GUARD' | 'CONTROLLER' | 'HANDLER' | 'UNKNOWN';
export type GraphRelation = 'CALLS' | 'AUTHORIZES' | 'HANDLED_BY' | 'BELONGS_TO' | 'CONTINUES' | 'GRANTS';

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  layer: GraphLayer;
  label: string;
  sublabel?: string;
  meta?: Record<string, unknown>;
};
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  /** 95 = derivado de configuración (decoradores, literales de ruta); 40 = heurístico. Nunca 100: no hay corrida. */
  confidence: number;
  evidence: string[];
  label?: string;
};
export type FlowGraph = { nodes: GraphNode[]; edges: GraphEdge[]; stats: { nodes: number; edges: number; flows: number; unknown: number } };

type FlowRow = Pick<
  SystemFlowCatalogModel,
  | 'flowId'
  | 'name'
  | 'systemCode'
  | 'module'
  | 'httpMethod'
  | 'path'
  | 'controller'
  | 'handler'
  | 'isPublic'
  | 'roles'
  | 'internalPermissions'
  | 'guards'
  | 'callers'
  | 'risk'
  | 'kind'
  | 'testStatus'
  | 'contractStatus'
  | 'findingsCount'
>;

function authLabel(flow: FlowRow): { label: string; sublabel: string } {
  if (flow.isPublic) return { label: 'Pública', sublabel: '@Public' };
  if (flow.internalPermissions.length) return { label: 'Permiso interno', sublabel: flow.internalPermissions.join(', ') };
  if (flow.roles.length) return { label: 'Rol del token', sublabel: flow.roles.join(', ') };
  if (flow.guards.length) return { label: 'Guard propio', sublabel: flow.guards.join(', ') };
  return { label: 'Sólo JWT', sublabel: 'guard global' };
}

class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private unknown = 0;

  node(node: GraphNode): string {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
    return node.id;
  }

  edge(source: string, target: string, relation: GraphRelation, proof: { evidence: string[]; confidence?: number; label?: string }): void {
    const id = `${source}->${target}:${relation}`;
    if (!this.edges.has(id))
      this.edges.set(id, {
        id,
        source,
        target,
        relation,
        confidence: proof.confidence ?? 95,
        evidence: proof.evidence,
        label: proof.label,
      });
  }

  /** La cadena de un flujo: quién lo llama → request → endpoint → autorización → handler → lo que la fase 1 no sabe. */
  addFlow(flow: FlowRow, options: { includeCallers: boolean; includeRoles: boolean }): void {
    const auth = authLabel(flow);
    const endpointId = this.node({
      id: `endpoint:${flow.flowId}`,
      type: 'ENDPOINT',
      layer: 'API',
      label: `${flow.httpMethod} /${flow.path}`,
      sublabel: flow.name,
      meta: {
        flowId: flow.flowId,
        risk: flow.risk,
        kind: flow.kind,
        testStatus: flow.testStatus,
        contractStatus: flow.contractStatus,
        findingsCount: flow.findingsCount,
        systemCode: flow.systemCode,
        module: flow.module,
      },
    });
    if (options.includeCallers) {
      for (const caller of flow.callers) {
        const callerId = this.node({
          id: `client:${caller}`,
          type: 'CLIENT',
          layer: 'CLIENT',
          label: caller,
          sublabel: /BACKEND|ENGINE|DASHBOARDS$/.test(caller) && !/PORTAL|APP/.test(caller) ? 'bloque' : 'cliente',
        });
        this.edge(callerId, endpointId, 'CALLS', { evidence: ['ROUTE_LITERAL'], label: 'CALLS' });
      }
    }
    const guardId = this.node({
      id: `guard:${flow.flowId}`,
      type: 'GUARD',
      layer: 'BACKEND',
      label: auth.label,
      sublabel: auth.sublabel,
      meta: { isPublic: flow.isPublic },
    });
    this.edge(endpointId, guardId, 'AUTHORIZES', { evidence: ['NEST_REFLECTOR'], label: 'AUTHORIZES' });
    if (options.includeRoles) {
      for (const role of [...flow.internalPermissions.map((p) => `perm:${p}`), ...flow.roles.map((r) => `role:${r}`)]) {
        const roleId = this.node({
          id: `actor:${role}`,
          type: 'ACTOR',
          layer: 'CLIENT',
          label: role.slice(role.indexOf(':') + 1),
          sublabel: role.startsWith('perm:') ? 'permiso interno' : 'rol del token',
        });
        this.edge(roleId, guardId, 'GRANTS', { evidence: ['NEST_REFLECTOR'], label: 'GRANTS' });
      }
    }
    const controllerId = this.node({
      id: `controller:${flow.systemCode}:${flow.controller}`,
      type: 'CONTROLLER',
      layer: 'BACKEND',
      label: flow.controller,
      sublabel: `${flow.systemCode} · ${flow.module}`,
    });
    const handlerId = this.node({
      id: `handler:${flow.flowId}`,
      type: 'HANDLER',
      layer: 'BACKEND',
      label: `${flow.handler}()`,
      sublabel: flow.controller,
      meta: { flowId: flow.flowId },
    });
    this.edge(guardId, handlerId, 'HANDLED_BY', { evidence: ['NEST_REFLECTOR'], label: 'HANDLED_BY' });
    this.edge(handlerId, controllerId, 'BELONGS_TO', { evidence: ['NEST_REFLECTOR'] });
    // Veracidad con hueco explícito (PLAN.md §3, P1): la fase 1 no sigue el handler hasta el service ni la tabla.
    const unknownId = this.node({
      id: `unknown:${flow.flowId}`,
      type: 'UNKNOWN',
      layer: 'DATA',
      label: 'Service → tablas',
      sublabel: 'sin resolver: fase 2 (AST) / fase 3 (trazas)',
      meta: { reason: 'NOT_ANALYZED_YET' },
    });
    this.edge(handlerId, unknownId, 'CONTINUES', { evidence: ['NONE'], confidence: 40 });
    this.unknown += 1;
  }

  build(flows: number): FlowGraph {
    const nodes = [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
    const edges = [...this.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    return { nodes, edges, stats: { nodes: nodes.length, edges: edges.length, flows, unknown: this.unknown } };
  }
}

/** Grafo de un flujo: su cadena completa, con quién lo llama y qué rol lo concede. */
export function buildFlowGraph(flow: FlowRow): FlowGraph {
  const builder = new GraphBuilder();
  builder.addFlow(flow, { includeCallers: true, includeRoles: true });
  return builder.build(1);
}

/**
 * Grafo de un módulo: todos sus flujos compartiendo clientes y controllers. Los roles se omiten
 * por defecto porque en un módulo de 60 rutas duplican las aristas sin añadir lectura; se piden aparte.
 */
export function buildModuleGraph(flows: FlowRow[], options: { includeRoles?: boolean } = {}): FlowGraph {
  const builder = new GraphBuilder();
  for (const flow of flows) builder.addFlow(flow, { includeCallers: true, includeRoles: options.includeRoles ?? false });
  return builder.build(flows.length);
}
