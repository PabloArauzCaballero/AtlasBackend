# Read models (`read_api`) — Proyecto Atlas

Implementa la Fase 3 del plan: separar el **contrato de lectura** del modelo de escritura mediante
vistas PostgreSQL versionadas. Migración: `20260715120000-create-read-api-schema-and-views-v1.ts`.

## Principios

- **Proyección explícita:** ninguna vista usa `SELECT *`; se enumeran columnas.
- **Una fila por caso de uso:** overview por cliente, corrida por evaluación, ítem por tarea.
- **Sin columnas sensibles:** nunca hashes, blobs cifrados, PII completa, tokens ni secretos.
- **Versionadas:** `read_api.v_<caso>_v1`. Un cambio incompatible crea `_v2`, no rompe `_v1`.
- **Filtrar y paginar en PostgreSQL:** las vistas exponen las claves de cursor; el backend no baja
  todo y recorta en Node.js.

## Vistas de la primera ola

| Vista                                       | Grano                          | Fuentes principales                                                                 |
| ------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `read_api.v_customer_overview_v1`           | Una fila por cliente           | customers, customer_profile_versions, risk_assessment_results, customer_consents, customer_device_links, manual_review_cases, fraud_cases |
| `read_api.v_risk_assessment_summary_v1`     | Una fila por corrida de riesgo | risk_assessment_runs + risk_assessment_results (resultado más reciente)              |
| `read_api.v_operations_work_queue_v1`       | Una fila por tarea abierta      | manual_review_cases, fraud_cases, data_quality_issues, data_subject_requests         |
| `read_api.v_provider_health_latest_v1`      | Una fila por proveedor          | provider_health_logs (último por proveedor) + data_providers                        |
| `read_api.v_notification_delivery_summary_v1` | Una fila por mensaje          | notification_messages + agregados de notification_deliveries                        |
| `read_api.v_system_endpoint_coverage_v1`    | Una fila por endpoint           | system_endpoint_catalog + impactos de entidad + suites por módulo                   |
| `read_api.v_audit_event_feed_v1`            | Una fila por evento             | Envuelve la vista `audit_event_feed` (cursor real sobre 8 fuentes)                  |

### Notas de diseño (realidad del esquema)

- **"Abierto" = ausencia de cierre.** `v_operations_work_queue_v1` filtra por `closed_at IS NULL` /
  `resolved_at IS NULL` en vez de listas de estados, para ser robusta ante los distintos vocabularios
  de estado de cada tabla (`manual_review_cases.status`, `fraud_cases.case_status`,
  `data_quality_issues.issue_status`, `data_subject_requests.status`).
- **Consentimiento activo** = `granted = true AND revoked_at IS NULL` (no hay columna `status`).
- **Dispositivo activo** = `link_status = 'active'` y no borrado.
- **Notificaciones entregadas/fallidas** se cuentan por presencia de timestamp (`delivered_at`,
  `failed_at`), no por strings de estado.
- **`module_test_suite_count`** es por módulo: las suites se asocian a módulo, no a endpoint (por eso
  el nombre lo aclara).
- **`v_customer_overview_v1`** expone solo `primary_email_domain` y `primary_phone_last_4`, nunca el
  email/teléfono/documento cifrado.

## Paginación por cursor recomendada

| Vista                                 | Cursor sugerido                                            |
| ------------------------------------- | --------------------------------------------------------- |
| `v_operations_work_queue_v1`          | `(priority, created_at, queue_item_type, queue_item_id)`  |
| `v_audit_event_feed_v1`               | `(occurred_at, source_table, source_id)`                  |
| `v_risk_assessment_summary_v1`        | `(requested_at DESC, risk_assessment_run_id DESC)`        |
| `v_notification_delivery_summary_v1`  | `(created_at DESC, message_id DESC)`                      |

No usar `OFFSET` profundo en históricos. `OFFSET` solo para catálogos pequeños/pantallas admin.

## Índices de soporte

La migración crea (IF NOT EXISTS) los índices que alinean las fuentes con los accesos de las vistas,
entre otros:

- `risk_assessment_results (customer_id, decided_at DESC, _id DESC)` y `(risk_assessment_run_id, ...)`
- `manual_review_cases (_tenant_id, priority, opened_at DESC, _id DESC) WHERE closed_at IS NULL`
- `fraud_cases (_tenant_id, opened_at DESC, _id DESC) WHERE closed_at IS NULL`
- `notification_deliveries (notification_message_id)`
- `provider_health_logs (provider_id, checked_at DESC, _id DESC)`

## Privilegios

Las vistas son propiedad del owner (en el setup con roles, las migraciones corren como
`atlas_migrator` con `SET ROLE atlas_owner`). `atlas_app_ro` recibe USAGE en `read_api` + SELECT sobre
las vistas, y **no** acceso a las tablas base. La migración aplica estos grants condicionalmente si
los roles existen; en el despliegue también los aplica `ops/postgres/grants.sql`.

## Materialized views (Fase 6, solo con evidencia)

No se crean por defecto. Solo cuando una consulta agregada sea cara, se lea con frecuencia y tolere
staleness, con índice único + job de refresh concurrente + métrica de staleness (`read_api.mv_<agg>_v1`).

## Verificación pendiente (igual que el resto de migraciones del repo)

Esta migración fue escrita y verificada estáticamente contra los modelos Sequelize, pero debe correr
una vez contra el Postgres de CI y confirmarse con el gate de vistas (Fase 7): existencia en
`pg_views`, smoke `SELECT`, `EXPLAIN (ANALYZE, BUFFERS)` y equivalencia con el repositorio legado
donde aplique.
