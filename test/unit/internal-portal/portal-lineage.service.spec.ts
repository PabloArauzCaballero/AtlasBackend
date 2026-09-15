import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { PortalLineageService } from '../../../src/modules/internal-portal/application/portal-lineage.service.js';

/**
 * Grafo de linaje del portal interno.
 *
 * Responde a la pregunta que hace un analista antes de tocar nada: «si cambio esta tabla, ¿qué
 * endpoints se rompen?». Lo que estas pruebas fijan es que el grafo se arma desde el catálogo vivo
 * —no desde un dibujo mantenido a mano— y, sobre todo, la invariante que hace que la pantalla
 * dibuje algo: TODA arista devuelta tiene sus dos extremos entre los nodos devueltos. Las aristas
 * se piden acotadas a los nodos ya elegidos, así que una tabla fuera del catálogo no produce una
 * arista colgante sino ninguna arista.
 */
describe('PortalLineageService', () => {
  const entity = (over: Record<string, unknown> = {}) => ({
    _id: 1,
    schema_name: 'customer',
    table_name: 'customers',
    entity_name: 'Clientes',
    module: 'customers',
    status: 'active',
    review_status: 'reviewed',
    contains_pii: true,
    contains_risk_data: false,
    ...over,
  });

  const endpoint = (over: Record<string, unknown> = {}) => ({
    _id: 10,
    method: 'GET',
    full_path: '/customers/{id}',
    route_name: 'customers.get',
    module: 'customers',
    risk_level: 'LOW',
    status: 'active',
    contains_pii: true,
    ...over,
  });

  function build(options: { entities?: unknown[]; endpoints?: unknown[]; impacts?: unknown[]; relationships?: unknown[] } = {}) {
    // El doble discrimina por la FORMA de la consulta, no por el nombre de tabla: la consulta de
    // relaciones hace JOIN contra el catálogo de entidades y el conteo las nombra a todas.
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT (SELECT COUNT(*)')) {
        return [{ entities: '1', endpoints: '1', impacts: '1', relationships: '1' }];
      }
      if (sql.includes('FROM system_data_relationship_catalog')) return options.relationships ?? [];
      if (sql.includes('FROM system_endpoint_data_entity_impacts')) {
        return (
          options.impacts ?? [{ _id: 100, endpoint_id: 10, data_entity_id: 1, operation_type: 'WRITE', impact_level: 'HIGH', notes: null }]
        );
      }
      if (sql.includes('FROM system_data_entity_catalog')) return options.entities ?? [entity()];
      return options.endpoints ?? [endpoint()];
    });
    return { service: new PortalLineageService({ query } as never), query };
  }

  describe('getLineage', () => {
    it('arma nodos de tabla y de endpoint desde el catálogo vivo', async () => {
      const { service } = build();

      const graph = await service.getLineage({});

      expect(graph.nodes).toEqual([
        expect.objectContaining({ nodeId: 'table:1', nodeType: 'table', label: 'Clientes', criticality: 'HIGH' }),
        expect.objectContaining({ nodeId: 'endpoint:10', nodeType: 'endpoint', label: 'GET /customers/{id}' }),
      ]);
      expect(graph.summary).toMatchObject({ nodeCount: 2, edgeCount: 1, source: 'live_backend_catalog' });
    });

    /** Una tabla sin PII ni datos de riesgo no es crítica: marcarlo todo en rojo no informa nada. */
    it('la criticidad de una tabla sale de si guarda datos personales o de riesgo', async () => {
      const { service } = build({ entities: [entity({ contains_pii: false, contains_risk_data: false })] });
      const graph = await service.getLineage({});
      expect(graph.nodes[0]).toMatchObject({ criticality: 'MEDIUM' });
    });

    it('filtra los nodos por el texto buscado', async () => {
      const { service } = build();
      const graph = await service.getLineage({ q: 'clientes' });
      expect(graph.nodes.map((node) => node.nodeId)).toEqual(['table:1']);
    });

    it('la arista de impacto va del endpoint a la tabla que toca', async () => {
      const { service } = build();
      const graph = await service.getLineage({});
      expect(graph.edges[0]).toMatchObject({
        edgeId: 'impact:100',
        sourceNodeId: 'endpoint:10',
        targetNodeId: 'table:1',
        edgeType: 'WRITE',
      });
    });

    it('la relación entre tablas apunta a los ids de entidad resueltos por esquema y tabla', async () => {
      const { service } = build({
        impacts: [],
        relationships: [
          {
            _id: 200,
            relationship_type: 'FOREIGN_KEY',
            business_reason: 'cartera',
            source_schema: 'credit',
            source_table: 'loans',
            source_column: 'customer_id',
            target_schema: 'customer',
            target_table: 'customers',
            target_column: '_id',
            source_entity_id: 7,
            target_entity_id: 1,
          },
        ],
      });

      const graph = await service.getLineage({});

      expect(graph.edges[0]).toMatchObject({
        edgeId: 'relationship:200',
        sourceNodeId: 'table:7',
        targetNodeId: 'table:1',
        edgeType: 'FOREIGN_KEY',
        metadata: { sourceTable: 'credit.loans', targetTable: 'customer.customers' },
      });
    });

    /**
     * La razón de ser del arreglo: sin nodos de tabla no se piden aristas, en vez de traerlas y
     * dejar que el frontend las descarte en silencio.
     */
    it('no pide aristas cuando el filtro no dejó nodos de uno de los extremos', async () => {
      const { service, query } = build({ entities: [] });

      const graph = await service.getLineage({});

      expect(graph.edges).toEqual([]);
      // El conteo del resumen sí nombra ambas tablas; lo que no debe existir es la consulta de
      // aristas, que se reconoce por el `IN` contra los ids de nodo ya elegidos.
      const sqls = query.mock.calls.map(([sql]) => sql as string);
      expect(sqls.some((sql) => sql.includes('data_entity_id IN (:entityIds)'))).toBe(false);
      expect(sqls.some((sql) => sql.includes('FROM system_data_relationship_catalog r'))).toBe(false);
    });

    it('acota los nodos por tipo cuando la pantalla lo pide', async () => {
      const { service } = build();

      const graph = await service.getLineage({ nodeType: 'table' });

      expect(graph.nodes.map((node) => node.nodeId)).toEqual(['table:1']);
    });

    /** La pantalla tiene que poder decir «esto es una parte», no fingir que es el grafo completo. */
    it('el resumen declara cuánto se muestra frente a cuánto existe', async () => {
      const { service } = build();

      const graph = await service.getLineage({});

      expect(graph.summary).toMatchObject({
        tables: { shown: 1, total: 1 },
        endpoints: { shown: 1, total: 1 },
        truncated: false,
      });
    });
  });

  describe('getLineageNode', () => {
    it('devuelve el nodo con sus aristas de entrada, de salida y sus vecinos', async () => {
      const { service } = build();

      const node = await service.getLineageNode('table:1');

      expect(node).toMatchObject({ nodeId: 'table:1' });
      expect(node.incomingEdges.map((edge) => edge.edgeId)).toEqual(['impact:100']);
      expect(node.outgoingEdges).toEqual([]);
      expect(node.relatedNodes.map((related) => related.nodeId)).toEqual(['endpoint:10']);
    });

    it('acepta el identificador codificado en la URL', async () => {
      const { service } = build();
      await expect(service.getLineageNode(encodeURIComponent('endpoint:10'))).resolves.toMatchObject({ nodeId: 'endpoint:10' });
    });

    it('un nodo inexistente es un 404, no un grafo vacío', async () => {
      const { service } = build();
      await expect(service.getLineageNode('table:999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLineageImpact', () => {
    it('convierte cada arista en un impacto con su camino y lo pagina', async () => {
      const { service } = build();

      const page = await service.getLineageImpact({});

      expect(page.items).toEqual([
        expect.objectContaining({
          impactId: 'impact:100',
          impactType: 'WRITE',
          severity: 'HIGH',
          // El camino conserva el orden del grafo (tablas y luego endpoints), no el de la arista.
          path: [expect.objectContaining({ nodeId: 'table:1' }), expect.objectContaining({ nodeId: 'endpoint:10' })],
        }),
      ]);
    });
  });
});
