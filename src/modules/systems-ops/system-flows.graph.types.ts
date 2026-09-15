/**
 * @file Tipos de dominio: los nodos y aristas del grafo de Flujos.
 * @business Esta pieza fija el vocabulario con el que se dibuja cómo recorre el sistema una petición.
 * @system declara capas, tipos de nodo y relaciones que comparten el constructor del grafo y quien lo consume.
 */
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
  | 'EVENT'
  | 'UNKNOWN';
export type GraphRelation =
  | 'CALLS'
  | 'AUTHORIZES'
  | 'HANDLED_BY'
  | 'BELONGS_TO'
  | 'CONTINUES'
  | 'GRANTS'
  | 'READS'
  | 'WRITES'
  | 'THROWS'
  | 'CALLS_BLOCK'
  | 'ENQUEUES';

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
