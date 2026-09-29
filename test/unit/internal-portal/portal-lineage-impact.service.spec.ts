import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { PortalLineageImpactService } from '../../../src/modules/internal-portal/application/portal-lineage-impact.service.js';

/**
 * Impactos del linaje y ficha de nodo.
 *
 * Lo que se fija aquí es el contrato con la pantalla: los filtros llegan a SQL (no se descartan), el
 * total y el resumen por severidad cuentan todo lo filtrado (no la página), y una relación entre
 * tablas no lleva severidad —antes enseñaba su `business_reason` en esa columna—. Que el SQL filtre
 * de verdad lo mide la prueba de integración contra PostgreSQL (`test/integration/internal-portal`).
 */
const IMPACTO = {
  family: 'impact',
  edge_ref: '100',
  source_node_id: 'endpoint:10',
  target_node_id: 'table:1',
  impact_type: 'WRITE',
  severity: 'HIGH',
  description: 'escribe el saldo',
  source_type: 'endpoint',
  source_label: 'POST /loans',
  source_domain: 'credit',
  source_status: 'ACTIVE',
  source_criticality: 'HIGH',
  source_schema: null,
  source_table: null,
  target_type: 'table',
  target_label: 'Préstamos',
  target_domain: 'credit',
  target_status: 'ACTIVE',
  target_criticality: 'HIGH',
  target_schema: 'credit',
  target_table: 'loans',
};

const RELACION = {
  ...IMPACTO,
  family: 'relationship',
  edge_ref: '7',
  source_node_id: 'table:1',
  target_node_id: 'table:2',
  impact_type: 'FOREIGN_KEY',
  severity: null,
  description: 'el préstamo es de un cliente',
  source_type: 'table',
  source_schema: 'credit',
  source_table: 'loans',
};

function build(options: { page?: unknown[]; groups?: unknown[]; node?: unknown[]; edges?: unknown[] } = {}) {
  const query = jest.fn(async (sql: string, _options?: unknown) => {
    if (sql.includes('GROUP BY family, severity')) return (options.groups ?? []) as never;
    if (sql.includes('LIMIT :limit OFFSET :offset')) return (options.page ?? []) as never;
    if (sql.includes('source_node_id = :nodeId')) return (options.edges ?? []) as never;
    if (sql.includes('FROM system_data_entity_catalog WHERE _id::text = :refId') || sql.includes('FROM system_endpoint_catalog WHERE'))
      return (options.node ?? []) as never;
    return [] as never;
  });
  return { service: new PortalLineageImpactService({ query } as never), query };
}

const replacementsOf = (query: { mock: { calls: unknown[][] } }, fragment: string) =>
  (query.mock.calls.find(([sql]) => String(sql).includes(fragment))?.[1] as { replacements: Record<string, unknown> }).replacements;

describe('PortalLineageImpactService.getLineageImpact', () => {
  it('manda a SQL la severidad (en mayúsculas), la familia, el dominio y el buscador escapado', async () => {
    const { service, query } = build();

    await service.getLineageImpact({ q: '50%', severity: 'high', family: 'impact', domain: 'credit', page: 2, limit: 10 });

    expect(replacementsOf(query, 'LIMIT :limit OFFSET :offset')).toEqual({
      q: '50%',
      like: '%50\\%%',
      severity: 'HIGH',
      family: 'impact',
      domain: 'credit',
      limit: 10,
      offset: 10,
    });
  });

  it('un valor fuera de catálogo no se manda como filtro (no se inventa una severidad)', async () => {
    const { service, query } = build();

    await service.getLineageImpact({ severity: 'URGENTE', family: 'otra' });

    expect(replacementsOf(query, 'LIMIT :limit OFFSET :offset')).toMatchObject({ severity: '', family: '' });
  });

  it('el total y el resumen salen de contar lo filtrado, no de la página', async () => {
    const { service } = build({
      page: [IMPACTO],
      groups: [
        { family: 'impact', severity: 'HIGH', total: '30' },
        { family: 'impact', severity: 'LOW', total: '12' },
        { family: 'relationship', severity: null, total: '5' },
      ],
    });

    const result = await service.getLineageImpact({ page: 1, limit: 20 });

    expect(result.meta).toEqual({ page: 1, limit: 20, total: 47, totalPages: 3 });
    expect(result.summary).toEqual({
      bySeverity: { LOW: 12, MEDIUM: 0, HIGH: 30, CRITICAL: 0 },
      byFamily: { impact: 42, relationship: 5 },
    });
  });

  it('con un filtro de severidad el total cuenta sólo esa severidad, y las tarjetas siguen viendo todas', async () => {
    const { service } = build({
      groups: [
        { family: 'impact', severity: 'HIGH', total: '30' },
        { family: 'impact', severity: 'LOW', total: '12' },
        { family: 'relationship', severity: null, total: '5' },
      ],
    });

    const result = await service.getLineageImpact({ severity: 'LOW' });

    expect(result.meta.total).toBe(12);
    expect(result.summary.bySeverity).toMatchObject({ HIGH: 30, LOW: 12 });
    expect(result.summary.byFamily).toEqual({ impact: 12, relationship: 0 });
  });

  it('una relación entre tablas NO lleva severidad: su texto libre va en la descripción', async () => {
    const { service } = build({ page: [IMPACTO, RELACION] });

    const { items } = await service.getLineageImpact({});

    expect(items[0]).toMatchObject({ impactId: 'impact:100', family: 'impact', severity: 'HIGH', impactType: 'WRITE' });
    expect(items[1]).toMatchObject({
      impactId: 'relationship:7',
      family: 'relationship',
      severity: null,
      description: 'el préstamo es de un cliente',
    });
  });

  it('el camino lleva los dos extremos, con el esquema y la tabla para enlazar su impacto', async () => {
    const { service } = build({ page: [IMPACTO] });

    const { items } = await service.getLineageImpact({});

    expect(items[0].path).toEqual([
      expect.objectContaining({ nodeId: 'endpoint:10', nodeType: 'endpoint', label: 'POST /loans', referenceId: '10' }),
      expect.objectContaining({
        nodeId: 'table:1',
        nodeType: 'table',
        label: 'Préstamos',
        metadata: { schemaName: 'credit', tableName: 'loans' },
      }),
    ]);
  });
});

describe('PortalLineageImpactService.getLineageNode', () => {
  const tabla = {
    _id: 1,
    schema_name: 'credit',
    table_name: 'loans',
    entity_name: 'Préstamos',
    module: 'credit',
    status: 'ACTIVE',
    review_status: 'APPROVED',
    contains_pii: false,
    contains_risk_data: true,
  };

  it('resuelve el nodo por su id y trae SUS aristas, sin pasar por el grafo recortado', async () => {
    const { service, query } = build({ node: [tabla], edges: [IMPACTO, RELACION] });

    const node = await service.getLineageNode('table:1');

    expect(node).toMatchObject({ nodeId: 'table:1', label: 'Préstamos', criticality: 'HIGH', edgesTruncated: false });
    expect(node.incomingEdges.map((edge) => edge.edgeId)).toEqual(['impact:100']);
    expect(node.outgoingEdges.map((edge) => edge.edgeId)).toEqual(['relationship:7']);
    expect(node.relatedNodes.map((related) => related.nodeId)).toEqual(['endpoint:10', 'table:2']);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('LIMIT :nodeLimit'))).toBe(false);
  });

  it('acepta el identificador codificado en la URL', async () => {
    const endpoint = {
      _id: 10,
      method: 'POST',
      full_path: '/loans',
      route_name: 'loans',
      module: 'credit',
      risk_level: 'HIGH',
      status: 'ACTIVE',
    };
    const { service } = build({ node: [endpoint] });

    await expect(service.getLineageNode(encodeURIComponent('endpoint:10'))).resolves.toMatchObject({ nodeId: 'endpoint:10' });
  });

  it('un nodo inexistente o de un tipo desconocido es 404', async () => {
    const { service } = build();

    await expect(service.getLineageNode('table:999')).rejects.toThrow(NotFoundException);
    await expect(service.getLineageNode('report:1')).rejects.toThrow(NotFoundException);
  });

  it('si un nodo tiene más aristas que el tope, la ficha lo dice', async () => {
    const muchas = Array.from({ length: 501 }, (_, index) => ({ ...IMPACTO, edge_ref: String(index) }));
    const { service } = build({ node: [tabla], edges: muchas });

    const node = await service.getLineageNode('table:1');

    expect(node.edgesTruncated).toBe(true);
    expect(node.incomingEdges).toHaveLength(500);
  });
});

describe('lineageQuerySchema', () => {
  it('declara severity (normalizada a mayúsculas), family y domain en vez de descartarlos', async () => {
    const { lineageQuerySchema } = await import('../../../src/modules/internal-portal/internal-portal.schemas.js');

    expect(lineageQuerySchema.parse({ severity: 'high', family: 'relationship', domain: 'credit' })).toEqual({
      severity: 'HIGH',
      family: 'relationship',
      domain: 'credit',
    });
    expect(lineageQuerySchema.safeParse({ severity: 'URGENTE' }).success).toBe(false);
  });
});
