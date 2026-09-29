/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system declara el catálogo de términos del glosario como una sola consulta paginable en la base.
 */

/**
 * El glosario como UNA relación: dominios, tablas y campos catalogados, cada uno con su tipo,
 * clave, nombre, definición, dominio y dueño.
 *
 * Antes se leían 80 dominios, 120 tablas y 240 campos (`LIMIT` fijos) y se paginaba en memoria: el
 * total decía 440 cuando el catálogo tenía más, lo que quedaba fuera no se encontraba con ningún
 * buscador, y la ficha de una tabla más allá de la 120 respondía 404. Aquí el filtro, el orden, el
 * total y la página los resuelve PostgreSQL sobre el catálogo entero.
 *
 * El dominio de un término es su código de dominio cuando está declarado y, si no, el módulo de su
 * tabla: así un filtro «dominio = RIESGO» trae el dominio, sus tablas y sus campos, y no sólo los que
 * alguien rellenó a mano. `kind_order` fija el orden de lectura: dominios, luego tablas, luego campos.
 */
export const GLOSSARY_TERMS_CTE = `
WITH terms AS (
  SELECT 'domain'::text AS kind,
         d.domain_code::text AS ref_id,
         d.domain_code::text AS term_key,
         COALESCE(NULLIF(d.domain_name, ''), d.domain_code)::text AS name,
         d.description::text AS definition,
         d.domain_code::text AS domain,
         d.owner_team::text AS owner,
         'ACTIVE'::text AS status,
         d._updated_at AS updated_at,
         d.data_nature::text AS data_nature,
         NULL::text AS schema_name,
         NULL::text AS table_name,
         NULL::text AS review_status,
         NULL::text AS sensitivity_level,
         1 AS kind_order,
         d.domain_code::text AS sort_key
    FROM system_domain_catalog d
  UNION ALL
  SELECT 'table',
         e._id::text,
         e.table_name::text,
         COALESCE(NULLIF(e.entity_name, ''), e.table_name)::text,
         e.business_purpose::text,
         COALESCE(NULLIF(e.domain_code, ''), NULLIF(e.module, ''), 'platform')::text,
         e.data_owner::text,
         COALESCE(NULLIF(e.status, ''), 'ACTIVE')::text,
         e._updated_at,
         NULL::text,
         e.schema_name::text,
         e.table_name::text,
         e.review_status::text,
         NULL::text,
         2,
         (COALESCE(e.module, '') || '.' || e.table_name)::text
    FROM system_data_entity_catalog e
  UNION ALL
  SELECT 'field',
         f._id::text,
         (f.table_name || '.' || f.column_name)::text,
         COALESCE(NULLIF(f.business_name, ''), f.column_name)::text,
         f.business_meaning::text,
         COALESCE(NULLIF(f.domain_code, ''), NULLIF(fe.domain_code, ''), NULLIF(fe.module, ''), 'PLATAFORMA')::text,
         'data-governance'::text,
         'ACTIVE'::text,
         f._updated_at,
         NULL::text,
         f.schema_name::text,
         f.table_name::text,
         NULL::text,
         f.sensitivity_level::text,
         3,
         (f.table_name || '.' || lpad(COALESCE(f.ordinal_position, 0)::text, 6, '0'))::text
    FROM system_data_field_catalog f
    LEFT JOIN system_data_entity_catalog fe ON fe._id = f.data_entity_id
   WHERE COALESCE(f.status, 'ACTIVE') <> 'DEPRECATED'
)`;

/**
 * Filtros del listado. `:q` vacío desactiva el buscador; el patrón llega ya escapado
 * (`containsLikePattern`). Se busca en la clave, el nombre, la definición, el dominio y el dueño: es
 * exactamente lo que promete el buscador de la pantalla.
 */
export const GLOSSARY_WHERE = `
 WHERE (:q = '' OR term_key ILIKE :like OR name ILIKE :like OR COALESCE(definition, '') ILIKE :like
        OR domain ILIKE :like OR COALESCE(owner, '') ILIKE :like)
   AND (:domain = '' OR lower(domain) = lower(:domain))
   AND (:kind = '' OR kind = :kind)`;

export const GLOSSARY_PAGE_SQL = `${GLOSSARY_TERMS_CTE}
SELECT * FROM terms${GLOSSARY_WHERE}
 ORDER BY kind_order ASC, sort_key ASC, ref_id ASC
 LIMIT :limit OFFSET :offset`;

export const GLOSSARY_COUNT_SQL = `${GLOSSARY_TERMS_CTE}
SELECT COUNT(*)::text AS total FROM terms${GLOSSARY_WHERE}`;

/** Un término por su identificador (`kind` + `ref_id`): la ficha no depende de ninguna página. */
export const GLOSSARY_TERM_BY_REF_SQL = `${GLOSSARY_TERMS_CTE}
SELECT * FROM terms WHERE kind = :kind AND ref_id = :ref LIMIT 1`;

/** Valores del filtro «Dominio» y reparto por tipo, sobre el catálogo entero y no sobre una página. */
export const GLOSSARY_FACETS_SQL = `${GLOSSARY_TERMS_CTE}
SELECT 'domain' AS facet, domain AS value, COUNT(*)::text AS total FROM terms GROUP BY domain
UNION ALL
SELECT 'kind', kind, COUNT(*)::text FROM terms GROUP BY kind
ORDER BY 1 ASC, 2 ASC`;

/** Tablas de los dominios de la página: por código de dominio declarado o, en su defecto, por módulo. */
export const GLOSSARY_DOMAIN_TABLES_SQL = `
SELECT _id::text AS id, table_name, lower(COALESCE(NULLIF(domain_code, ''), module, '')) AS domain_key, lower(COALESCE(module, '')) AS module_key
  FROM system_data_entity_catalog
 WHERE lower(COALESCE(NULLIF(domain_code, ''), module, '')) IN (:codes) OR lower(COALESCE(module, '')) IN (:codes)
 ORDER BY table_name ASC`;

/** Columnas vivas de las tablas (por id o por nombre) y de los dominios de la página. */
export const GLOSSARY_RELATED_FIELDS_SQL = `
SELECT data_entity_id::text AS data_entity_id, table_name, column_name, lower(COALESCE(domain_code, '')) AS domain_key
  FROM system_data_field_catalog
 WHERE COALESCE(status, 'ACTIVE') <> 'DEPRECATED'
   AND (data_entity_id::text IN (:entityIds) OR lower(table_name) IN (:tableNames) OR lower(COALESCE(domain_code, '')) IN (:codes))
 ORDER BY table_name ASC, ordinal_position ASC`;

export const GLOSSARY_RELATED_ENDPOINTS_SQL = `
SELECT i.data_entity_id::text AS data_entity_id, e.method, e.full_path
  FROM system_endpoint_data_entity_impacts i
  JOIN system_endpoint_catalog e ON e._id = i.endpoint_id
 WHERE i.data_entity_id::text IN (:entityIds)`;
