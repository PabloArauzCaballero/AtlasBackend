/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system guarda el SQL de Flujos que no cabe en el repositorio sin taparlo: corridas por ruta y procesos de negocio.
 */
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const LOGS = atlasSchemaFor('system_action_logs');
const FLOWS = atlasSchemaFor('system_flow_catalog');
const SCREENS = atlasSchemaFor('system_screen_catalog');
const OUTBOX = atlasSchemaFor('outbox_events');
const JOBS = atlasSchemaFor('system_job_runs');
const MESSAGES = atlasSchemaFor('notification_messages');
const DELIVERIES = atlasSchemaFor('notification_deliveries');
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
            -- Los clientes que mide otro bloque no gastan el tope ni el denominador. El nulo se queda:
            -- se cuenta aparte como «sin cliente», y los códigos desconocidos siguen a la vista.
            AND (origin_client IS NULL OR origin_client NOT IN (:clientesDeOtrosBloques))
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
 * Eventos de DOMINIO escritos en la ventana, y cuántos produjeron de verdad un aviso.
 *
 * El vínculo es `notification_messages.outbox_event_id`, no un cruce por nombre. Se probaron las dos
 * vías tentadoras y engañaban: `notification_policies` son preferencias por categoría con otro
 * vocabulario (`payment_received`), y ese cruce acusaba en falso a `payment.confirmed`, que sí avisa;
 * y `locked_by` está vacío en todos porque `process_events` lo limpia al terminar.
 *
 * `api_command` se excluye: son los eventos de compatibilidad de cada mutación, sin consumidor a
 * propósito.
 *
 * Lo que corrigió la revisión de la primera versión, todo del mismo tipo —un cero que no significa
 * lo que parece—:
 * - **Estado**: un evento pendiente o fallido tampoco tiene mensaje, y contaba como «sin aviso». Se
 *   separan los procesados, que son los únicos de los que se puede concluir algo.
 * - **Mensaje no es aviso**: la fila se escribe `pending` ANTES de entregar. Lo que prueba que salió
 *   hacia alguien es una entrega `sent`/`delivered`. Medido en el servidor: `user.registered` tiene
 *   sus correos en `failed`.
 * - **Por código, no por código y tipo**: el registro admite varios tipos de agregado por familia, y
 *   un mismo código salía en dos filas y podía caer en dos listas a la vez.
 * - **Tope con aviso**: se pide una fila de más para poder decir que se cortó.
 *
 * El JOIN con entregas multiplica filas, por eso TODO se cuenta con DISTINCT.
 */
export const DOMAIN_EVENTS_LIMIT = 500;

export const DOMAIN_EVENT_CONSUMERS_SQL = `SELECT o.event_code,
              array_agg(DISTINCT o.aggregate_type)                           AS aggregate_types,
              COUNT(DISTINCT o._id)                                          AS events,
              COUNT(DISTINCT o._id) FILTER (WHERE o.status = 'processed')    AS processed,
              COUNT(DISTINCT o._id) FILTER (WHERE o.status = 'failed')       AS failed,
              COUNT(DISTINCT m.outbox_event_id)                              AS events_with_message,
              COUNT(DISTINCT m._id)                                          AS messages,
              COUNT(DISTINCT d.notification_message_id)
                FILTER (WHERE d.status IN ('sent', 'delivered'))             AS messages_sent,
              MAX(o._created_at)                                             AS last_event_at
         FROM ${OUTBOX}.outbox_events o
         LEFT JOIN ${MESSAGES}.notification_messages m ON m.outbox_event_id = o._id
         LEFT JOIN ${DELIVERIES}.notification_deliveries d ON d.notification_message_id = m._id
        WHERE o.aggregate_type <> 'api_command'
          AND o._created_at >= NOW() - (:windowDays || ' days')::interval
        GROUP BY o.event_code
        ORDER BY COUNT(DISTINCT m.outbox_event_id) ASC, COUNT(DISTINCT o._id) DESC, o.event_code
        LIMIT ${DOMAIN_EVENTS_LIMIT + 1}`;

/**
 * Pantallas cuya puerta declarada en el menú NO es la que aplica la API.
 *
 * ## La pregunta, con la corrección que costó una primera versión inútil
 *
 * La primera versión preguntaba «¿el endpoint tiene permiso fino?», y eso no es lo mismo que «¿está
 * protegido?». `RolesGuard` es global y `@Roles(...)` deniega igual: de los 1 029 flujos del
 * catálogo, 995 no tienen permiso fino pero **914 sí tienen roles**. Es decir, el 92 % de lo que
 * aquel detector podía emitir era falso —y el único candidato que produjo con tráfico real lo era—.
 * Una lista donde casi todo es ruido es una lista que nadie lee, que es el fallo que este proyecto
 * lleva persiguiendo desde la ola 12.
 *
 * Ahora se distinguen tres desenlaces, y sólo el primero es una avería:
 *
 * - `SIN_GUARDA`: ni permiso, ni roles, ni `@Public`. La ruta la puede llamar cualquiera con sesión,
 *   y el menú promete que hace falta un permiso. Hoy son 29 flujos en todo el catálogo.
 * - `PUBLIC`: `@Public` declarado. Puede estar perfectamente bien —un login, un webhook— y por eso
 *   no se mezcla con lo anterior: en el mismo saco se ignorarían los dos.
 * - `SOLO_ROL`: la API exige roles pero no el permiso que el menú declara. No está abierta; es OTRA
 *   puerta. Quien tenga el rol y no el permiso no ve la pantalla y sí puede llamar a la ruta.
 *
 * ## Por qué el JOIN se ata a ATLAS_BACKEND
 *
 * No es una aproximación: las aristas observadas salen de `system_action_logs`, que sólo registra lo
 * que llega a ESTE backend. Sin esa condición el JOIN cruzaba por (método, ruta) contra los cuatro
 * bloques —45 pares están duplicados entre sistemas— y atribuía a una pantalla endpoints de un
 * backend que nunca tocó.
 */
/** Tope de filas de la deriva. Al alcanzarlo, la respuesta se declara cortada. */
export const RBAC_DRIFT_LIMIT = 5000;

export const RBAC_DRIFT_SQL = `WITH llamadas AS (
         SELECT s.client_code,
                s.route,
                s.nav_permissions,
                s.nav_roles,
                r->>'method' AS method,
                r->>'path'   AS path
           FROM ${SCREENS}.system_screen_catalog s
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(s.observed_json->'routes') = 'array'
                  THEN s.observed_json->'routes' ELSE '[]'::jsonb END
           ) AS r
          WHERE s.verification = 'VERIFIED'
            -- El menú puede restringir por permiso O por rol; mirar sólo lo primero dejaba fuera
            -- pantallas que sí declaran una puerta.
            AND (jsonb_array_length(s.nav_permissions) > 0 OR jsonb_array_length(s.nav_roles) > 0)
       )
       SELECT l.client_code, l.route, l.nav_permissions, l.nav_roles, l.method, l.path,
              f.flow_id, f.internal_permissions, f.roles, f.is_public
         FROM llamadas l
         JOIN ${FLOWS}.system_flow_catalog f
           ON f.system_code = 'ATLAS_BACKEND' AND f.http_method = l.method AND f.path = l.path
        WHERE jsonb_array_length(f.internal_permissions) = 0
        ORDER BY l.client_code, l.route, l.method, l.path
        LIMIT ${RBAC_DRIFT_LIMIT}`;

/**
 * Lo que cada flujo deja ENCARGADO al terminar de responder, atribuido a la petición exacta.
 *
 * ## Tres correcciones sobre la primera versión, medidas
 *
 * - **El cruce sólo por `correlation_id` multiplicaba.** La app reutiliza el MISMO id en la
 *   petición que recibe 401, en el `/auth/refresh` y en el reintento: tres filas de log para un
 *   evento. Simulado: 3 eventos reales se contaban como 9, y aparecían GET como flujos que encolan.
 *   El evento guarda método y ruta en su carga, así que se ata a la fila con ese método, esa ruta y
 *   un estado < 400 (el outbox sólo escribe en éxito). Medido: 455 de 455 cruzan así, 1:1.
 * - **La ventana escondía los atascos más graves.** Filtraba también los pendientes por fecha, así
 *   que con 1 día no salía nunca nada atascado y con 30 un pendiente de 40 días desaparecía. La
 *   ventana limita ahora sólo lo PROCESADO; lo pendiente o fallido cuenta tenga la edad que tenga.
 * - **El orden cortaba primero lo más viejo.** Se ordena por el pendiente o fallido más antiguo.
 *
 * El margen de cinco minutos entre la fila de log y el evento no es una aproximación: los dos se
 * escriben al terminar la misma petición. Sirve para que el cruce use el índice de correlación en
 * vez de leer entero `system_action_logs`, que crece con cada request.
 */
export const PENDING_WORK_SQL = `WITH eventos AS (
         SELECT o._id, o.status, o._created_at, o.processed_at, o.event_code, o._tenant_id, o.correlation_id,
                o.event_payload_json->>'method'                  AS ev_method,
                split_part(o.event_payload_json->>'path', '?', 1) AS ev_path
           FROM ${OUTBOX}.outbox_events o
          WHERE o.status <> 'processed'
             OR o._created_at >= NOW() - (:windowDays || ' days')::interval
       ),
       atribuidos AS (
         SELECT DISTINCT ON (e._id)
                e._id, e.status, e._created_at, e.processed_at, e.event_code, e._tenant_id, l.method,
                regexp_replace(regexp_replace(l.route_template, '^/?(api/v1|api|v1)/', ''), ':[A-Za-z_][A-Za-z0-9_]*', ':p', 'g') AS path
           FROM eventos e
           JOIN ${LOGS}.system_action_logs l
             ON l.correlation_id = e.correlation_id
            AND l.method = e.ev_method
            AND l.resolved_url_sanitized = e.ev_path
            AND l.response_status_code < 400
            AND l.route_template IS NOT NULL
            AND l.occurred_at BETWEEN e._created_at - interval '5 minutes' AND e._created_at + interval '5 minutes'
          ORDER BY e._id, l.occurred_at DESC
       )
       SELECT method, path,
              COUNT(*)                                                                AS events,
              COUNT(*) FILTER (WHERE status = 'pending')                              AS pending,
              COUNT(*) FILTER (WHERE status = 'processed')                            AS processed,
              COUNT(*) FILTER (WHERE status = 'failed')                               AS failed,
              COUNT(*) FILTER (WHERE status NOT IN ('pending', 'processed', 'failed')) AS other,
              COUNT(*) FILTER (WHERE status = 'pending' AND _tenant_id IS NULL)        AS pending_without_tenant,
              MIN(_created_at) FILTER (WHERE status = 'pending')                      AS pending_since,
              MAX(processed_at)                                                        AS last_processed_at,
              (array_agg(DISTINCT event_code))[1:5]                                    AS codes
         FROM atribuidos
        GROUP BY method, path
        ORDER BY MIN(_created_at) FILTER (WHERE status IN ('pending', 'failed')) ASC NULLS LAST, method, path
        LIMIT 500`;

/**
 * El estado del outbox ENTERO y del consumidor, sin pasar por la atribución.
 *
 * Existe por dos cosas que el cruce por flujo no puede decir. La primera: si el consumidor corre en
 * este entorno. Sin eso, un stack local sin worker enseñaba cientos de pendientes «atascados» que
 * nadie iba a recoger nunca AHÍ, y era un artefacto del entorno, no una avería. La segunda: cuánto
 * queda sin poder atribuirse a ninguna petición —el log de éxito es fire-and-forget y puede faltar—,
 * que sin este total desaparecería del recuento en silencio.
 */
export const OUTBOX_HEALTH_SQL = `SELECT
         (SELECT COUNT(*) FROM ${OUTBOX}.outbox_events WHERE status = 'pending')                        AS pending,
         (SELECT COUNT(*) FROM ${OUTBOX}.outbox_events WHERE status = 'pending' AND _tenant_id IS NULL) AS pending_without_tenant,
         (SELECT COUNT(*) FROM ${OUTBOX}.outbox_events WHERE status = 'failed')                         AS failed,
         (SELECT MIN(_created_at) FROM ${OUTBOX}.outbox_events WHERE status = 'pending')                AS oldest_pending,
         (SELECT MAX(completed_at) FROM ${JOBS}.system_job_runs
           WHERE job_code = 'process_outbox' AND status = 'completed')                                 AS consumer_last_run`;

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
