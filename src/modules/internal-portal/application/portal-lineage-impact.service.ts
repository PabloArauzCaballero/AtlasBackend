/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system lista las aristas del linaje paginadas en la base y resuelve la ficha de un nodo sin recortar el grafo.
 */
import { NotFoundException } from '@nestjs/common';
import { clean, intValue, parsePage, Query, Row } from './portal-format.util.js';
import { containsLikePattern } from '../../../common/utils/strings/like-pattern.util.js';
import { PortalQueryBase } from './portal-query.base.js';
import {
  LINEAGE_EDGES_PAGE_SQL,
  LINEAGE_EDGES_SUMMARY_SQL,
  LINEAGE_ENDPOINT_NODE_SQL,
  LINEAGE_NODE_EDGES_SQL,
  LINEAGE_TABLE_NODE_SQL,
} from './portal-lineage-sql.constants.js';
import { EdgeRow, edgeEndpoints, EntityRow, LineageNodeView, toEdge, toEndpointNode, toTableNode } from './portal-lineage-nodes.util.js';

export const LINEAGE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const LINEAGE_FAMILIES = ['impact', 'relationship'] as const;

/** Tope de aristas en la ficha de UN nodo. Si se alcanza, la respuesta lo dice (`edgesTruncated`). */
const NODE_EDGE_LIMIT = 500;

/**
 * Impacto entre activos y ficha de nodo del linaje.
 *
 * Antes las dos cosas salían del grafo de `getLineage` —cortado a 1000 nodos por tipo y 2000 aristas
 * por familia— y se paginaban en memoria: un impacto o un nodo fuera del corte no existía, el filtro
 * `severity` no estaba declarado (Zod lo descartaba) y la columna «Severidad» de una relación entre
 * tablas mostraba su `business_reason`. Ahora la lista y el total salen de SQL sobre el catálogo
 * entero, el filtro se aplica en la base y el resumen por severidad cuenta todo lo filtrado.
 */
export class PortalLineageImpactService extends PortalQueryBase {
  async getLineageImpact(query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '').trim();
    const severity = clean(query.severity, '').toUpperCase();
    const family = clean(query.family, '');
    const filters = {
      q,
      like: containsLikePattern(q),
      family: (LINEAGE_FAMILIES as readonly string[]).includes(family) ? family : '',
      domain: clean(query.domain, '').trim(),
      severity: (LINEAGE_SEVERITIES as readonly string[]).includes(severity) ? severity : '',
    };
    const [rows, groups] = await Promise.all([
      this.queryRows<EdgeRow>(LINEAGE_EDGES_PAGE_SQL, { ...filters, limit: page.limit, offset: page.offset }),
      this.queryRows<{ family: string; severity: string | null; total: string }>(LINEAGE_EDGES_SUMMARY_SQL, filters),
    ]);

    const bySeverity = Object.fromEntries(LINEAGE_SEVERITIES.map((level) => [level, 0])) as Record<string, number>;
    const byFamily = { impact: 0, relationship: 0 } as Record<string, number>;
    let total = 0;
    for (const group of groups) {
      const count = intValue(group.total, 0);
      if (group.family === 'impact' && group.severity) bySeverity[group.severity] = (bySeverity[group.severity] ?? 0) + count;
      // Con un filtro de severidad sólo cuentan las aristas de ESA severidad (las relaciones no tienen).
      if (filters.severity && group.severity !== filters.severity) continue;
      byFamily[group.family] = (byFamily[group.family] ?? 0) + count;
      total += count;
    }

    return {
      items: rows.map((row) => ({
        impactId: `${row.family}:${row.edge_ref}`,
        family: row.family,
        sourceNodeId: row.source_node_id,
        targetNodeId: row.target_node_id,
        impactType: row.impact_type,
        severity: row.family === 'impact' ? row.severity : null,
        description: row.description,
        path: edgeEndpoints(row),
      })),
      meta: { page: page.page, limit: page.limit, total, totalPages: Math.max(1, Math.ceil(total / page.limit)) },
      summary: { bySeverity, byFamily },
    };
  }

  /**
   * La ficha de un nodo se resuelve por su id y con SUS aristas, no buscándolo dentro del grafo
   * recortado: con la versión anterior un nodo fuera de los primeros 1000 respondía 404.
   */
  async getLineageNode(nodeId: string) {
    const decoded = decodeURIComponent(nodeId);
    const separator = decoded.indexOf(':');
    const kind = decoded.slice(0, separator);
    const refId = decoded.slice(separator + 1);
    const node = await this.loadNode(kind, refId);
    if (!node) throw new NotFoundException('LINEAGE_NODE_NOT_FOUND');

    const rows = await this.queryRows<EdgeRow>(LINEAGE_NODE_EDGES_SQL, { nodeId: node.nodeId, limit: NODE_EDGE_LIMIT + 1 });
    const edgeRows = rows.slice(0, NODE_EDGE_LIMIT);
    const related = new Map<string, LineageNodeView>();
    for (const row of edgeRows) {
      for (const end of edgeEndpoints(row)) if (end.nodeId !== node.nodeId) related.set(end.nodeId, end);
    }
    const edges = edgeRows.map((row) => toEdge(row));
    return {
      ...node,
      incomingEdges: edges.filter((edge) => edge.targetNodeId === node.nodeId),
      outgoingEdges: edges.filter((edge) => edge.sourceNodeId === node.nodeId),
      relatedNodes: [...related.values()],
      edgesTruncated: rows.length > NODE_EDGE_LIMIT,
    };
  }

  private async loadNode(kind: string, refId: string) {
    if (!refId) return undefined;
    if (kind === 'table') {
      const [row] = await this.queryRows<EntityRow & Row>(LINEAGE_TABLE_NODE_SQL, { refId });
      return row ? toTableNode(row) : undefined;
    }
    if (kind === 'endpoint') {
      const [row] = await this.queryRows(LINEAGE_ENDPOINT_NODE_SQL, { refId });
      return row ? toEndpointNode(row) : undefined;
    }
    return undefined;
  }
}
