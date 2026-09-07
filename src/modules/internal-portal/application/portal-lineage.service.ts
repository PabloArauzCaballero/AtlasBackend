/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { NotFoundException } from '@nestjs/common';
import { boolValue, clean, containsQuery, id, intValue, nullableText, paginate, Query, Row } from './portal-format.util.js';
import { PortalQueryBase } from './portal-query.base.js';

/** Tope por defecto de nodos de cada tipo (tablas y endpoints se piden por separado). */
const DEFAULT_NODE_LIMIT = 400;
const MAX_NODE_LIMIT = 1000;
/** Tope de aristas de cada familia. Se aplica DESPUÉS de acotar a los nodos cargados. */
const EDGE_LIMIT = 2000;

type EntityRow = {
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

/**
 * Grafo de linaje del portal interno: nodos (tablas y endpoints) y aristas (impactos y relaciones).
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10).
 *
 * La regla que sostiene esta pantalla: **una arista solo existe si sus dos extremos existen**. El
 * grafo se armaba antes al revés —80 tablas, 80 endpoints y luego las aristas de toda la base— y el
 * frontend descartaba en silencio (`layoutGraph`) cualquier arista cuyo origen o destino no hubiera
 * entrado en esa ventana. Medido contra la base de dev: de 160 impactos traídos solo 86 eran
 * dibujables, y las relaciones tabla→tabla se resolvían por NOMBRE contra esas 80 tablas, así que
 * las que caían fuera salían como `table-name:X` —un id que no es de ningún nodo— y desaparecían.
 * Ahora los nodos se eligen primero (con el filtro aplicado en SQL, no sobre la ventana) y las
 * aristas se piden acotadas a esos ids, de modo que lo que se devuelve es dibujable por completo.
 */
export class PortalLineageService extends PortalQueryBase {
  async getLineage(query: Query) {
    const q = clean(query.q, '').toLowerCase();
    const nodeLimit = Math.min(MAX_NODE_LIMIT, Math.max(1, intValue(query.nodeLimit, DEFAULT_NODE_LIMIT)));
    const nodeType = clean(query.nodeType, '').toLowerCase();

    const [entityRows, endpointRows, totals] = await Promise.all([
      nodeType === 'endpoint' ? Promise.resolve([]) : this.loadEntityRows(q, nodeLimit),
      nodeType === 'table' ? Promise.resolve([]) : this.loadEndpointRows(q, nodeLimit),
      this.countTotals(),
    ]);

    // El filtro en memoria se conserva además del de SQL: cubre los campos derivados del nodo
    // (criticidad, estado normalizado) que no son columnas y que la pantalla sí muestra.
    const tableNodes = entityRows.map((row) => this.toTableNode(row)).filter((node) => containsQuery(node, q));
    const endpointNodes = endpointRows.map((row) => this.toEndpointNode(row)).filter((node) => containsQuery(node, q));
    const nodes = [...tableNodes, ...endpointNodes];

    const entityIds = tableNodes.map((node) => node.referenceId);
    const endpointIds = endpointNodes.map((node) => node.referenceId);
    const [impacts, relationships] = await Promise.all([
      this.loadImpactEdges(entityIds, endpointIds),
      this.loadRelationshipEdges(entityIds),
    ]);
    const edges = [...impacts.map((row) => this.toImpactEdge(row)), ...relationships.map((row) => this.toRelationshipEdge(row))];

    return {
      nodes,
      edges,
      generatedAt: new Date().toISOString(),
      summary: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        source: 'live_backend_catalog',
        // La pantalla necesita poder decir «esto es una parte», no fingir que es todo.
        tables: { shown: tableNodes.length, total: totals.entities },
        endpoints: { shown: endpointNodes.length, total: totals.endpoints },
        impactEdges: { shown: impacts.length, total: totals.impacts },
        relationshipEdges: { shown: relationships.length, total: totals.relationships },
        truncated: tableNodes.length < totals.entities || endpointNodes.length < totals.endpoints,
      },
    };
  }

  private loadEntityRows(q: string, nodeLimit: number) {
    return this.queryRows<EntityRow>(
      `SELECT _id, schema_name, table_name, entity_name, module, status, review_status, contains_pii, contains_risk_data
         FROM system_data_entity_catalog
        WHERE :q = ''
           OR lower(coalesce(entity_name, '') || ' ' || coalesce(table_name, '') || ' ' || coalesce(schema_name, '') || ' ' || coalesce(module, '')) LIKE :like
        ORDER BY table_name ASC
        LIMIT :nodeLimit`,
      { q, like: `%${q}%`, nodeLimit },
    );
  }

  private loadEndpointRows(q: string, nodeLimit: number) {
    return this.queryRows(
      `SELECT _id, method, full_path, route_name, module, risk_level, status, contains_pii
         FROM system_endpoint_catalog
        WHERE :q = ''
           OR lower(coalesce(method, '') || ' ' || coalesce(full_path, '') || ' ' || coalesce(route_name, '') || ' ' || coalesce(module, '')) LIKE :like
        ORDER BY module ASC, full_path ASC
        LIMIT :nodeLimit`,
      { q, like: `%${q}%`, nodeLimit },
    );
  }

  private toTableNode(row: EntityRow) {
    return {
      nodeId: `table:${id(row._id)}`,
      nodeType: 'table',
      label: clean(row.entity_name, clean(row.table_name)),
      domain: clean(row.module),
      status: clean(row.status),
      criticality: boolValue(row.contains_pii) || boolValue(row.contains_risk_data) ? 'HIGH' : 'MEDIUM',
      referenceId: id(row._id),
      metadata: { schemaName: clean(row.schema_name), tableName: clean(row.table_name), reviewStatus: clean(row.review_status) },
    };
  }

  private toEndpointNode(row: Row) {
    return {
      nodeId: `endpoint:${id(row._id)}`,
      nodeType: 'endpoint',
      label: `${clean(row.method)} ${clean(row.full_path)}`,
      domain: clean(row.module),
      status: clean(row.status),
      criticality: clean(row.risk_level),
      referenceId: id(row._id),
      metadata: { routeName: clean(row.route_name), containsPii: boolValue(row.contains_pii) },
    };
  }

  private toImpactEdge(row: Row) {
    return {
      edgeId: `impact:${id(row._id)}`,
      sourceNodeId: `endpoint:${id(row.endpoint_id)}`,
      targetNodeId: `table:${id(row.data_entity_id)}`,
      edgeType: clean(row.operation_type, 'READ'),
      label: clean(row.impact_level),
      metadata: { notes: nullableText(row.notes) },
    };
  }

  private toRelationshipEdge(row: Row) {
    return {
      edgeId: `relationship:${id(row._id)}`,
      sourceNodeId: `table:${id(row.source_entity_id)}`,
      targetNodeId: `table:${id(row.target_entity_id)}`,
      edgeType: clean(row.relationship_type, 'RELATED_TO'),
      label: clean(row.business_reason),
      metadata: {
        sourceTable: `${clean(row.source_schema)}.${clean(row.source_table)}`,
        targetTable: `${clean(row.target_schema)}.${clean(row.target_table)}`,
        sourceColumn: nullableText(row.source_column),
        targetColumn: nullableText(row.target_column),
      },
    };
  }

  /**
   * Impactos endpoint→tabla acotados a los nodos ya elegidos: sin este `IN` la consulta devolvía
   * aristas hacia tablas o endpoints que no estaban en el grafo y que el layout tiraba a la basura.
   */
  private loadImpactEdges(entityIds: string[], endpointIds: string[]) {
    if (entityIds.length === 0 || endpointIds.length === 0) return Promise.resolve([]);
    return this.queryRows(
      `SELECT _id, endpoint_id, data_entity_id, operation_type, impact_level, notes
         FROM system_endpoint_data_entity_impacts
        WHERE data_entity_id IN (:entityIds)
          AND endpoint_id IN (:endpointIds)
        ORDER BY _id ASC
        LIMIT :edgeLimit`,
      { entityIds, endpointIds, edgeLimit: EDGE_LIMIT },
    );
  }

  /**
   * Relaciones tabla→tabla resueltas por (esquema, tabla) contra el catálogo, no por nombre suelto.
   * Tras la partición en esquemas de dominio hay nombres repetidos entre esquemas, y resolver solo
   * por nombre emparejaba la tabla equivocada o no emparejaba nada. El `JOIN` además garantiza que
   * ambos extremos son entidades catalogadas y cargadas.
   */
  private loadRelationshipEdges(entityIds: string[]) {
    if (entityIds.length === 0) return Promise.resolve([]);
    return this.queryRows(
      `SELECT r._id,
              r.relationship_type,
              r.business_reason,
              r.source_schema,
              r.source_table,
              r.source_column,
              r.target_schema,
              r.target_table,
              r.target_column,
              se._id AS source_entity_id,
              te._id AS target_entity_id
         FROM system_data_relationship_catalog r
         JOIN system_data_entity_catalog se
           ON se.schema_name = r.source_schema AND se.table_name = r.source_table
         JOIN system_data_entity_catalog te
           ON te.schema_name = r.target_schema AND te.table_name = r.target_table
        WHERE se._id IN (:entityIds)
          AND te._id IN (:entityIds)
        ORDER BY r._id ASC
        LIMIT :edgeLimit`,
      { entityIds, edgeLimit: EDGE_LIMIT },
    );
  }

  private async countTotals() {
    const [rows] = await this.queryRows<{ entities: string; endpoints: string; impacts: string; relationships: string }>(
      `SELECT (SELECT COUNT(*)::text FROM system_data_entity_catalog) AS entities,
              (SELECT COUNT(*)::text FROM system_endpoint_catalog) AS endpoints,
              (SELECT COUNT(*)::text FROM system_endpoint_data_entity_impacts) AS impacts,
              (SELECT COUNT(*)::text FROM system_data_relationship_catalog) AS relationships`,
    );
    return {
      entities: intValue(rows?.entities, 0),
      endpoints: intValue(rows?.endpoints, 0),
      impacts: intValue(rows?.impacts, 0),
      relationships: intValue(rows?.relationships, 0),
    };
  }

  async getLineageNode(nodeId: string) {
    const graph = await this.getLineage({});
    const decoded = decodeURIComponent(nodeId);
    const node = graph.nodes.find((item) => item.nodeId === decoded);
    if (!node) throw new NotFoundException('LINEAGE_NODE_NOT_FOUND');
    const incomingEdges = graph.edges.filter((edge) => edge.targetNodeId === decoded);
    const outgoingEdges = graph.edges.filter((edge) => edge.sourceNodeId === decoded);
    const relatedIds = new Set([...incomingEdges.map((edge) => edge.sourceNodeId), ...outgoingEdges.map((edge) => edge.targetNodeId)]);
    return { ...node, incomingEdges, outgoingEdges, relatedNodes: graph.nodes.filter((item) => relatedIds.has(item.nodeId)) };
  }

  async getLineageImpact(query: Query) {
    const graph = await this.getLineage(query);
    const items = graph.edges.map((edge) => ({
      impactId: edge.edgeId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      impactType: edge.edgeType,
      severity: clean(edge.label, 'MEDIUM'),
      description: nullableText(edge.label) ?? 'Impacto de linaje registrado por catálogo.',
      path: graph.nodes.filter((node) => node.nodeId === edge.sourceNodeId || node.nodeId === edge.targetNodeId),
    }));
    return paginate(items, query);
  }
}
