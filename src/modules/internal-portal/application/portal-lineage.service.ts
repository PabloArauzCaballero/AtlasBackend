import { NotFoundException } from '@nestjs/common';
import { boolValue, clean, containsQuery, id, nullableText, paginate, Query } from './portal-format.util.js';
import { PortalQueryBase } from './portal-query.base.js';

/**
 * Grafo de linaje del portal interno: nodos (tablas y endpoints) y aristas (impactos y relaciones).
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios de comportamiento.
 */
export class PortalLineageService extends PortalQueryBase {
  async getLineage(query: Query) {
    const q = clean(query.q, '').toLowerCase();
    const [entities, endpoints, impacts, relationships] = await Promise.all([
      this.queryRows(
        `SELECT _id, table_name, entity_name, module, status, review_status, contains_pii, contains_risk_data FROM system_data_entity_catalog ORDER BY table_name ASC LIMIT 80`,
      ),
      this.queryRows(
        `SELECT _id, method, full_path, route_name, module, risk_level, status, contains_pii FROM system_endpoint_catalog ORDER BY module ASC, full_path ASC LIMIT 80`,
      ),
      this.queryRows(
        `SELECT _id, endpoint_id, data_entity_id, operation_type, impact_level, notes FROM system_endpoint_data_entity_impacts ORDER BY _id ASC LIMIT 160`,
      ),
      this.queryRows(
        `SELECT _id, source_table, target_table, relationship_type, business_reason FROM system_data_relationship_catalog ORDER BY _id ASC LIMIT 160`,
      ),
    ]);
    const nodes = [
      ...entities.map((row) => ({
        nodeId: `table:${id(row._id)}`,
        nodeType: 'table',
        label: clean(row.entity_name, clean(row.table_name)),
        domain: clean(row.module),
        status: clean(row.status),
        criticality: boolValue(row.contains_pii) || boolValue(row.contains_risk_data) ? 'HIGH' : 'MEDIUM',
        referenceId: id(row._id),
        metadata: { tableName: clean(row.table_name), reviewStatus: clean(row.review_status) },
      })),
      ...endpoints.map((row) => ({
        nodeId: `endpoint:${id(row._id)}`,
        nodeType: 'endpoint',
        label: `${clean(row.method)} ${clean(row.full_path)}`,
        domain: clean(row.module),
        status: clean(row.status),
        criticality: clean(row.risk_level),
        referenceId: id(row._id),
        metadata: { routeName: clean(row.route_name), containsPii: boolValue(row.contains_pii) },
      })),
    ].filter((node) => containsQuery(node, q));
    const tableByName = new Map(entities.map((row) => [clean(row.table_name), `table:${id(row._id)}`]));
    const edges = [
      ...impacts.map((row) => ({
        edgeId: `impact:${id(row._id)}`,
        sourceNodeId: `endpoint:${id(row.endpoint_id)}`,
        targetNodeId: `table:${id(row.data_entity_id)}`,
        edgeType: clean(row.operation_type, 'READ'),
        label: clean(row.impact_level),
        metadata: { notes: nullableText(row.notes) },
      })),
      ...relationships.map((row) => ({
        edgeId: `relationship:${id(row._id)}`,
        sourceNodeId: tableByName.get(clean(row.source_table)) ?? `table-name:${clean(row.source_table)}`,
        targetNodeId: tableByName.get(clean(row.target_table)) ?? `table-name:${clean(row.target_table)}`,
        edgeType: clean(row.relationship_type, 'RELATED_TO'),
        label: clean(row.business_reason),
        metadata: { sourceTable: clean(row.source_table), targetTable: clean(row.target_table) },
      })),
    ];
    return {
      nodes,
      edges,
      generatedAt: new Date().toISOString(),
      summary: { nodeCount: nodes.length, edgeCount: edges.length, source: 'live_backend_catalog' },
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
