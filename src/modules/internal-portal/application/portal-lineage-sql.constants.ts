/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system declara las aristas del linaje (endpoint→tabla y tabla→tabla) como una relación paginable.
 */

/**
 * Criticidad derivada de una tabla: lo que guarda datos personales o de riesgo es `HIGH`. Es la
 * misma regla que el grafo aplica a sus nodos, para que la tabla y el grafo no discrepen.
 */
const tableCriticality = (alias: string) => `CASE WHEN ${alias}.contains_pii OR ${alias}.contains_risk_data THEN 'HIGH' ELSE 'MEDIUM' END`;

/**
 * Las dos familias de arista del linaje con sus dos extremos ya resueltos.
 *
 * - `impact`: un endpoint lee o escribe una tabla. Su severidad es `impact_level`, un valor
 *   controlado por CHECK (LOW/MEDIUM/HIGH/CRITICAL).
 * - `relationship`: una tabla referencia a otra. NO tiene severidad: antes la lista ponía en esa
 *   columna el `business_reason` de la relación, que es texto libre, y lo presentaba como si lo fuera.
 *
 * Los extremos se resuelven con `JOIN` y no con un recorte previo de nodos: la lista de impactos se
 * armaba sobre un grafo cortado a 1000 nodos y 2000 aristas y lo que caía fuera no existía.
 */
export const LINEAGE_EDGES_CTE = `
WITH edges AS (
  SELECT 'impact'::text AS family,
         i._id::text AS edge_ref,
         ('endpoint:' || i.endpoint_id::text) AS source_node_id,
         ('table:' || i.data_entity_id::text) AS target_node_id,
         COALESCE(NULLIF(i.operation_type, ''), 'READ')::text AS impact_type,
         upper(i.impact_level)::text AS severity,
         i.notes::text AS description,
         'endpoint'::text AS source_type,
         (ep.method || ' ' || ep.full_path)::text AS source_label,
         ep.module::text AS source_domain,
         ep.status::text AS source_status,
         ep.risk_level::text AS source_criticality,
         NULL::text AS source_schema,
         NULL::text AS source_table,
         'table'::text AS target_type,
         COALESCE(NULLIF(te.entity_name, ''), te.table_name)::text AS target_label,
         te.module::text AS target_domain,
         te.status::text AS target_status,
         ${tableCriticality('te')}::text AS target_criticality,
         te.schema_name::text AS target_schema,
         te.table_name::text AS target_table
    FROM system_endpoint_data_entity_impacts i
    JOIN system_endpoint_catalog ep ON ep._id = i.endpoint_id
    JOIN system_data_entity_catalog te ON te._id = i.data_entity_id
  UNION ALL
  SELECT 'relationship',
         r._id::text,
         ('table:' || se._id::text),
         ('table:' || rt._id::text),
         COALESCE(NULLIF(r.relationship_type, ''), 'RELATED_TO')::text,
         NULL::text,
         r.business_reason::text,
         'table',
         COALESCE(NULLIF(se.entity_name, ''), se.table_name)::text,
         se.module::text,
         se.status::text,
         ${tableCriticality('se')}::text,
         se.schema_name::text,
         se.table_name::text,
         'table',
         COALESCE(NULLIF(rt.entity_name, ''), rt.table_name)::text,
         rt.module::text,
         rt.status::text,
         ${tableCriticality('rt')}::text,
         rt.schema_name::text,
         rt.table_name::text
    FROM system_data_relationship_catalog r
    JOIN system_data_entity_catalog se ON se.schema_name = r.source_schema AND se.table_name = r.source_table
    JOIN system_data_entity_catalog rt ON rt.schema_name = r.target_schema AND rt.table_name = r.target_table
)`;

/**
 * Filtros comunes del listado de impactos, SIN la severidad: el resumen por severidad se cuenta con
 * estos filtros para que las tarjetas digan cuántos hay de cada una en lo que se está mirando.
 */
export const LINEAGE_EDGES_BASE_WHERE = `
 WHERE (:q = '' OR source_label ILIKE :like OR target_label ILIKE :like OR impact_type ILIKE :like
        OR COALESCE(description, '') ILIKE :like OR COALESCE(target_table, '') ILIKE :like)
   AND (:family = '' OR family = :family)
   AND (:domain = '' OR lower(COALESCE(source_domain, '')) = lower(:domain) OR lower(COALESCE(target_domain, '')) = lower(:domain))`;

export const LINEAGE_EDGES_PAGE_SQL = `${LINEAGE_EDGES_CTE}
SELECT * FROM edges${LINEAGE_EDGES_BASE_WHERE}
   AND (:severity = '' OR severity = :severity)
 ORDER BY family ASC, source_label ASC, target_label ASC, edge_ref ASC
 LIMIT :limit OFFSET :offset`;

export const LINEAGE_EDGES_SUMMARY_SQL = `${LINEAGE_EDGES_CTE}
SELECT family, severity, COUNT(*)::text AS total FROM edges${LINEAGE_EDGES_BASE_WHERE}
 GROUP BY family, severity`;

/** Aristas que entran o salen de UN nodo: la ficha del nodo no depende de ningún recorte del grafo. */
export const LINEAGE_NODE_EDGES_SQL = `${LINEAGE_EDGES_CTE}
SELECT * FROM edges WHERE source_node_id = :nodeId OR target_node_id = :nodeId
 ORDER BY family ASC, source_label ASC, target_label ASC
 LIMIT :limit`;

export const LINEAGE_TABLE_NODE_SQL = `
SELECT _id, schema_name, table_name, entity_name, module, status, review_status, contains_pii, contains_risk_data
  FROM system_data_entity_catalog WHERE _id::text = :refId LIMIT 1`;

export const LINEAGE_ENDPOINT_NODE_SQL = `
SELECT _id, method, full_path, route_name, module, risk_level, status, contains_pii
  FROM system_endpoint_catalog WHERE _id::text = :refId LIMIT 1`;
