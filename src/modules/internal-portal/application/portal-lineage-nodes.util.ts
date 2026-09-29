/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system traduce filas del catálogo a nodos y aristas del linaje con una sola forma para grafo, lista y ficha.
 */
import { boolValue, clean, id, nullableText, Row } from './portal-format.util.js';

export type EntityRow = {
  _id: unknown;
  schema_name: unknown;
  table_name: unknown;
  entity_name: unknown;
  module: unknown;
  status: unknown;
  review_status: unknown;
  contains_pii: unknown;
  contains_risk_data: unknown;
};

/** Fila de `LINEAGE_EDGES_CTE`: una arista con sus dos extremos ya resueltos. */
export type EdgeRow = {
  family: 'impact' | 'relationship';
  edge_ref: string;
  source_node_id: string;
  target_node_id: string;
  impact_type: string;
  severity: string | null;
  description: string | null;
  source_type: string;
  source_label: string;
  source_domain: string | null;
  source_status: string | null;
  source_criticality: string | null;
  source_schema: string | null;
  source_table: string | null;
  target_type: string;
  target_label: string;
  target_domain: string | null;
  target_status: string | null;
  target_criticality: string | null;
  target_schema: string | null;
  target_table: string | null;
};

export function toTableNode(row: EntityRow) {
  return {
    nodeId: `table:${id(row._id)}`,
    nodeType: 'table',
    label: clean(row.entity_name, clean(row.table_name)),
    domain: clean(row.module),
    status: clean(row.status),
    criticality: boolValue(row.contains_pii) || boolValue(row.contains_risk_data) ? 'HIGH' : 'MEDIUM',
    referenceId: id(row._id),
    metadata: { schemaName: clean(row.schema_name), tableName: clean(row.table_name), reviewStatus: clean(row.review_status) } as Row,
  };
}

export function toEndpointNode(row: Row) {
  return {
    nodeId: `endpoint:${id(row._id)}`,
    nodeType: 'endpoint',
    label: `${clean(row.method)} ${clean(row.full_path)}`,
    domain: clean(row.module),
    status: clean(row.status),
    criticality: clean(row.risk_level),
    referenceId: id(row._id),
    metadata: { routeName: clean(row.route_name), containsPii: boolValue(row.contains_pii) } as Row,
  };
}

export type LineageNodeView = ReturnType<typeof toTableNode>;

/** Los dos extremos de una arista, con la misma forma que los nodos del grafo. */
export function edgeEndpoints(row: EdgeRow): [LineageNodeView, LineageNodeView] {
  const node = (side: 'source' | 'target'): LineageNodeView => {
    const nodeId = side === 'source' ? row.source_node_id : row.target_node_id;
    const schema = side === 'source' ? row.source_schema : row.target_schema;
    const table = side === 'source' ? row.source_table : row.target_table;
    return {
      nodeId,
      nodeType: side === 'source' ? row.source_type : row.target_type,
      label: side === 'source' ? row.source_label : row.target_label,
      domain: clean(side === 'source' ? row.source_domain : row.target_domain),
      status: clean(side === 'source' ? row.source_status : row.target_status),
      criticality: clean(side === 'source' ? row.source_criticality : row.target_criticality),
      referenceId: nodeId.slice(nodeId.indexOf(':') + 1),
      metadata: table ? { schemaName: clean(schema), tableName: clean(table) } : {},
    };
  };
  return [node('source'), node('target')];
}

export function toEdge(row: EdgeRow) {
  return {
    edgeId: `${row.family}:${row.edge_ref}`,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    edgeType: row.impact_type,
    label: row.family === 'impact' ? clean(row.severity) : clean(row.description),
    metadata: { notes: nullableText(row.description) } as Row,
  };
}
