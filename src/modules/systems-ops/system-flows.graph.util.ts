/**
 * @file Utilidad de dominio: arma el grafo de Flujos a partir del catálogo derivado, sin mirar la base.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system construye nodos y aristas tipados (cliente → endpoint → autorización → handler → services → tablas / errores) por flujo o por módulo.
 */
import { SystemFlowCatalogModel } from '../../database/models/index.js';
import { FlowAnalysis, flowAnalysisSchema } from './system-flows.schemas.js';
import { env } from '../../config/env.js';

export type GraphLayer = 'CLIENT' | 'API' | 'BACKEND' | 'DATA';
export type GraphNodeType =
  | 'ACTOR'
  | 'CLIENT'
  | 'ENDPOINT'
  | 'GUARD'
  | 'CONTROLLER'
  | 'HANDLER'
  | 'SERVICE'
  | 'REPOSITORY'
  | 'DATABASE'
  | 'ERROR'
  | 'BLOCK_CALL'
  | 'UNKNOWN';
export type GraphRelation =
  'CALLS' | 'AUTHORIZES' | 'HANDLED_BY' | 'BELONGS_TO' | 'CONTINUES' | 'GRANTS' | 'READS' | 'WRITES' | 'THROWS' | 'CALLS_BLOCK';

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
  /** 95 = configuración (decoradores, literales); 75 = AST resuelto por tipo; 40 = hueco. Nunca 100: no hay corrida. */
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
> & { analysisJson?: Record<string, unknown> };

type Proof = { evidence: string[]; confidence?: number; label?: string };
const AST: Proof = { evidence: ['STATIC_AST_DIRECT'], confidence: 75 };

function authLabel(flow: FlowRow): { label: string; sublabel: string } {
  if (flow.isPublic) return { label: 'Pública', sublabel: '@Public' };
  if (flow.internalPermissions.length) return { label: 'Permiso interno', sublabel: flow.internalPermissions.join(', ') };
  if (flow.roles.length) return { label: 'Rol del token', sublabel: flow.roles.join(', ') };
  if (flow.guards.length) return { label: 'Guard propio', sublabel: flow.guards.join(', ') };
  return { label: 'Sólo JWT', sublabel: 'guard global' };
}

/** El JSON guardado pudo escribirlo una versión anterior del analizador: se valida, no se confía. */
function analysisOf(flow: FlowRow): FlowAnalysis | null {
  if (!flow.analysisJson || !('status' in flow.analysisJson)) return null;
  const parsed = flowAnalysisSchema.safeParse(flow.analysisJson);
  return parsed.success && parsed.data.status !== 'DISCOVERED' ? parsed.data : null;
}

class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private unknown = 0;

  node(node: GraphNode): string {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
    return node.id;
  }

  edge(source: string, target: string, relation: GraphRelation, proof: Proof): void {
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

  private addFront(flow: FlowRow, options: { includeCallers: boolean; includeRoles: boolean }): string {
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
    if (options.includeCallers)
      for (const caller of flow.callers) {
        const callerId = this.node({
          id: `client:${caller}`,
          type: 'CLIENT',
          layer: 'CLIENT',
          label: caller,
          sublabel: /PORTAL|APP/.test(caller) ? 'cliente' : 'bloque',
        });
        this.edge(callerId, endpointId, 'CALLS', { evidence: ['ROUTE_LITERAL'], label: 'CALLS' });
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
    if (options.includeRoles)
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
    return handlerId;
  }

  /** Lo que la fase 2 resolvió: services en orden de aparición (uno por clase), tablas, errores, salidas a otros bloques. */
  private addAnalysis(flow: FlowRow, a: FlowAnalysis, handlerId: string): void {
    let previous = handlerId;
    const seen = new Set<string>();
    for (const step of a.chain) {
      const owner = step.class ?? step.method;
      if (seen.has(owner)) continue;
      seen.add(owner);
      const kind = step.kind === 'REPOSITORY' ? 'REPOSITORY' : 'SERVICE';
      const id = this.node({
        id: `${kind.toLowerCase()}:${flow.systemCode}:${owner}`,
        type: kind,
        layer: 'BACKEND',
        label: owner,
        // El grafo enseñaba MÁS fuente que la ficha —el árbol de llamadas entero, no un fichero—, y
        // se le escapó al primer intento de cerrar esto: la ficha decía «—» y el grafo de la misma
        // pantalla seguía dando `fichero:línea` de cada paso.
        sublabel: env.FLOWS_EXPOSE_SOURCE ? `${step.file}:${step.line}` : `${kind.toLowerCase()} · profundidad ${step.depth}`,
        meta: env.FLOWS_EXPOSE_SOURCE ? { file: step.file, line: step.line } : { depth: step.depth },
      });
      this.edge(previous, id, 'CONTINUES', { ...AST, label: 'CALLS' });
      previous = id;
    }
    for (const table of a.reads) {
      const id = this.node({
        id: `table:${flow.systemCode}:${table}`,
        type: 'DATABASE',
        layer: 'DATA',
        label: table,
        sublabel: flow.systemCode,
      });
      this.edge(previous, id, 'READS', { ...AST, label: 'READS' });
    }
    for (const write of a.writes) {
      const id = this.node({
        id: `table:${flow.systemCode}:${write.table}`,
        type: 'DATABASE',
        layer: 'DATA',
        label: write.table,
        sublabel: flow.systemCode,
      });
      this.edge(previous, id, 'WRITES', { ...AST, label: write.op });
    }
    for (const error of a.errors) {
      const id = this.node({
        id: `error:${flow.systemCode}:${error}`,
        type: 'ERROR',
        layer: 'DATA',
        label: error,
        sublabel: 'rama de error',
      });
      this.edge(previous, id, 'THROWS', { ...AST, label: 'THROWS' });
    }
    for (const call of a.blockCalls) {
      const id = this.node({
        id: `block-call:${flow.flowId}:${call.target}`,
        type: 'BLOCK_CALL',
        layer: 'DATA',
        label: call.target,
        sublabel: `HTTP saliente · ${call.at}`,
      });
      this.edge(previous, id, 'CALLS_BLOCK', { ...AST, label: 'HTTP' });
    }
    if (a.unknowns.length) {
      const reasons = [...new Set(a.unknowns.map((u) => u.reason.split(':')[0]))];
      const id = this.node({
        id: `unknown:${flow.flowId}`,
        type: 'UNKNOWN',
        layer: 'DATA',
        label: `${a.unknowns.length} hueco(s)`,
        sublabel: reasons.join(', '),
        meta: { reasons, at: a.unknowns.slice(0, 5).map((u) => u.at) },
      });
      this.edge(previous, id, 'CONTINUES', { evidence: ['NONE'], confidence: 40 });
      this.unknown += 1;
    }
    if (a.transactional) {
      const handler = this.nodes.get(handlerId);
      if (handler) handler.meta = { ...handler.meta, transactional: true };
    }
  }

  addFlow(flow: FlowRow, options: { includeCallers: boolean; includeRoles: boolean }): void {
    const handlerId = this.addFront(flow, options);
    const analysis = analysisOf(flow);
    if (analysis) {
      this.addAnalysis(flow, analysis, handlerId);
      return;
    }
    // Veracidad con hueco explícito (PLAN.md §3, P1): sin análisis, del handler en adelante no se sabe nada.
    const unknownId = this.node({
      id: `unknown:${flow.flowId}`,
      type: 'UNKNOWN',
      layer: 'DATA',
      label: 'Service → tablas',
      sublabel: 'sin analizar: corre flows:analyze',
      meta: { reasons: ['NOT_ANALYZED_YET'] },
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

/** Grafo de un módulo: todos sus flujos compartiendo clientes, controllers, services y tablas. Los roles se piden aparte. */
export function buildModuleGraph(flows: FlowRow[], options: { includeRoles?: boolean } = {}): FlowGraph {
  const builder = new GraphBuilder();
  for (const flow of flows) builder.addFlow(flow, { includeCallers: true, includeRoles: options.includeRoles ?? false });
  return builder.build(flows.length);
}
