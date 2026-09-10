/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system guarda el SQL de Flujos que no cabe en el repositorio sin taparlo: corridas por ruta y procesos de negocio.
 */
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const LOGS = atlasSchemaFor('system_action_logs');
const FLOWS = atlasSchemaFor('system_flow_catalog');
const SCREENS = atlasSchemaFor('system_screen_catalog');
const WORKFLOW = atlasSchemaFor('workflow_definitions');

/**
 * Corridas por ruta dentro de la ventana. La plantilla del log se normaliza al formato del catálogo
 * aquí, en SQL, para que el cruce sea un JOIN y no un bucle en Node. Sólo agregados: ningún payload
 * sale de esta consulta.
 */
export const RUNS_BY_ROUTE_SQL = `WITH runs AS (
         SELECT method,
                regexp_replace(regexp_replace(route_template, '^/?(api/v1|api|v1)/', ''), ':[A-Za-z_][A-Za-z0-9_]*', ':p', 'g') AS path,
                response_status_code AS status,
                occurred_at,
                correlation_id
           FROM ${LOGS}.system_action_logs
          WHERE route_template IS NOT NULL
            AND occurred_at >= NOW() - (:windowDays || ' days')::interval
       ),
       latest AS (SELECT DISTINCT ON (method, path) method, path, status AS last_status FROM runs ORDER BY method, path, occurred_at DESC)
       SELECT r.method, r.path,
              COUNT(*) FILTER (WHERE r.status < 500) AS ok,
              COUNT(*) FILTER (WHERE r.status >= 500) AS failed,
              MAX(r.occurred_at) AS last_at,
              MAX(l.last_status) AS last_status,
              jsonb_object_agg(r.status::text, 1) AS statuses,
              (array_agg(r.correlation_id ORDER BY r.occurred_at DESC))[1:5] AS correlation_sample
         FROM runs r JOIN latest l USING (method, path)
        GROUP BY r.method, r.path`;

/**
 * Qué se ha hecho DESDE cada pantalla, dentro de la ventana.
 *
 * La arista pantalla→endpoint del catálogo se deriva del AST: dice lo que el código PARECE llamar.
 * Esto dice lo que de verdad se llamó cuando alguien abrió la pantalla, porque el portal declara su
 * ruta en `x-atlas-flow` y el interceptor la guarda en `origin_screen`.
 *
 * Se agrupa por pantalla y se devuelve el detalle por ruta llamada, que es lo que permite las dos
 * preguntas interesantes: «¿alguien ha usado esta pantalla?» y «¿llama a lo que dijimos que llama?».
 * `failed` cuenta sólo el 5xx: un 401 o un 404 desde una pantalla es el flujo haciendo lo que debe.
 */
/** Tope de grupos que se traen. Si se alcanza, quien consuma debe saber que faltan. */
export const SCREEN_RUNS_LIMIT = 20000;

export const SCREEN_RUNS_SQL = `WITH runs AS (
         SELECT origin_screen AS screen,
                origin_client AS client,
                method,
                regexp_replace(regexp_replace(route_template, '^/?(api/v1|api|v1)/', ''), ':[A-Za-z_][A-Za-z0-9_]*', ':p', 'g') AS path,
                response_status_code AS status,
                occurred_at
           FROM ${LOGS}.system_action_logs
          WHERE origin_screen IS NOT NULL
            AND route_template IS NOT NULL
            AND occurred_at >= NOW() - (:windowDays || ' days')::interval
       ),
       por_ruta AS (
         SELECT screen, client, method, path,
                COUNT(*) AS calls,
                COUNT(*) FILTER (WHERE status >= 500) AS failed,
                MAX(occurred_at) AS last_at
           FROM runs GROUP BY screen, client, method, path
       )
       SELECT screen, client,
              SUM(calls)::bigint  AS calls,
              SUM(failed)::bigint AS failed,
              MAX(last_at)        AS last_at,
              jsonb_agg(jsonb_build_object('method', method, 'path', path, 'calls', calls, 'failed', failed)
                        ORDER BY calls DESC) AS routes
         FROM por_ruta
        GROUP BY screen, client
        -- Tope de seguridad: una ruta con identificador produce una fila por entidad visitada, así
        -- que sin esto el tamaño de lo que entra en memoria crece con el tráfico y no con el número
        -- de pantallas. Se ordena por actividad para que lo que se corte sea lo menos usado.
        -- Desempate por pantalla y cliente: sin él, con miles de grupos empatados en una llamada,
        -- qué se corta cambia entre corridas y una pantalla aparecería usada un día y no al siguiente.
        ORDER BY SUM(calls) DESC, screen ASC, client ASC
        LIMIT ${SCREEN_RUNS_LIMIT}`;

/**
 * Pantallas cuyo MENÚ exige un permiso y que llaman a endpoints que no exigen ninguno.
 *
 * ## Por qué esto es un hallazgo y no una curiosidad
 *
 * Es exactamente el fallo que se corrigió a mano el 2026-09-10 en el propio módulo de Flujos: el
 * permiso existía, estaba sembrado, el menú lo usaba para decidir si enseñar la sección… y el
 * backend no lo exigía. Esconder una pantalla no protege sus datos —quien sabe la ruta de la API
 * entra igual—, y el catálogo de RBAC dice lo contrario. La pregunta que contesta esto es «¿de qué
 * otras pantallas es verdad lo mismo?».
 *
 * ## Por qué se cruza con aristas OBSERVADAS
 *
 * La arista pantalla→endpoint derivada del AST no existe: las llamadas viven en servicios
 * compartidos, no en el fichero de la página. Lo que sí existe desde la ola 9 es lo que de verdad se
 * llamó desde cada pantalla. Así que este detector sólo opina de pantallas que alguien ha usado, y
 * lo dice: sobre las demás no se afirma nada, en vez de inventar una arista plausible.
 */
export const RBAC_DRIFT_SQL = `WITH llamadas AS (
         SELECT s.client_code,
                s.route,
                s.nav_permissions,
                r->>'method' AS method,
                r->>'path'   AS path
           FROM ${SCREENS}.system_screen_catalog s
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.observed_json->'routes', '[]'::jsonb)) AS r
          WHERE s.verification = 'VERIFIED'
            AND jsonb_array_length(s.nav_permissions) > 0
       )
       SELECT l.client_code, l.route, l.nav_permissions, l.method, l.path,
              f.flow_id, f.internal_permissions, f.roles, f.is_public
         FROM llamadas l
         JOIN ${FLOWS}.system_flow_catalog f
           ON f.http_method = l.method AND f.path = l.path
        WHERE jsonb_array_length(f.internal_permissions) = 0
        ORDER BY l.client_code, l.route, l.method, l.path`;

/**
 * Los pasos de los procesos activos del `workflow-catalog`, cada uno con el flujo que lo implementa.
 * `LEFT JOIN` a propósito: un paso sin flujo es un paso declarado sobre una ruta que ya no existe,
 * y esconderlo con un JOIN interno sería perder justo el hallazgo. La ruta se normaliza igual que en
 * el catálogo: sin prefijo global, SIN BARRA INICIAL y con los parámetros como `:p` — olvidar la
 * barra dejaba los 87 pasos sin enlazar y parecía que ninguna ruta existía.
 */
export const BUSINESS_FLOWS_SQL = `SELECT d.workflow_code, d.name AS workflow_name, d.status, d.version,
              st.stage_code, st.name AS stage_name,
              s.step_code, s.name AS step_name, s.execution_order, s.http_method, s.route_path,
              s.is_mandatory, s.requires_auth, s.requires_idempotency_key,
              f.flow_id, f.risk, f.verification, f.test_status, f.module
         FROM ${WORKFLOW}.workflow_steps s
         JOIN ${WORKFLOW}.workflow_definitions d ON d._id = s.workflow_definition_id
         LEFT JOIN ${WORKFLOW}.workflow_stages st ON st._id = s.workflow_stage_id
         LEFT JOIN ${FLOWS}.system_flow_catalog f
                ON f.system_code = 'ATLAS_BACKEND'
               AND f.http_method = s.http_method
               AND f.path = regexp_replace(regexp_replace(regexp_replace(s.route_path, '^/?(api/v1|api|v1)/', ''), '^/', ''), ':[A-Za-z_][A-Za-z0-9_]*', ':p', 'g')
        WHERE d.status = 'active'
        ORDER BY d.workflow_code, st.stage_code NULLS FIRST, s.execution_order`;
