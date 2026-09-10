/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system guarda el SQL de Flujos que no cabe en el repositorio sin taparlo: corridas por ruta y procesos de negocio.
 */
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const LOGS = atlasSchemaFor('system_action_logs');
const FLOWS = atlasSchemaFor('system_flow_catalog');
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
