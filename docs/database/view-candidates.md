# Candidatos de vistas (Fase 0)

> Cada candidato debe justificarse con una consulta repetida o un problema medido en
> `read-workload-inventory.md` / `query-baseline.md` (§26). Una vista no se crea "porque sería más
> rápida"; se crea porque hay overfetching o joins repetidos medibles.

## Primera ola — YA IMPLEMENTADA (Fase 3)

Migración `20260715120000-create-read-api-schema-and-views-v1.ts`. Ver `read-models.md`.

| Vista                                         | Problema que resuelve                                                    | Estado |
| --------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| `read_api.v_customer_overview_v1`             | overview de cliente sin traer todas las versiones/dispositivos/consents  | ✅ creada |
| `read_api.v_operations_work_queue_v1`         | cola operativa unificada sin mezclar colecciones en memoria              | ✅ creada |
| `read_api.v_risk_assessment_summary_v1`       | decisión de riesgo sin contextos/contribuciones completas                | ✅ creada |
| `read_api.v_provider_health_latest_v1`        | estado actual por proveedor sin recorrer el histórico                    | ✅ creada |
| `read_api.v_notification_delivery_summary_v1` | resumen por mensaje sin devolver cada intento                            | ✅ creada |
| `read_api.v_system_endpoint_coverage_v1`      | cobertura por endpoint (riesgo, entidades, tests)                        | ✅ creada |
| `read_api.v_audit_event_feed_v1`              | feed de auditoría con cursor real (envuelve `audit_event_feed`)          | ✅ creada |

## Segunda ola — CANDIDATOS (crear solo con evidencia)

| Candidato                                 | Disparador esperado                                    | ¿Vista o matview? |
| ----------------------------------------- | ------------------------------------------------------ | ----------------- |
| `read_api.mv_operations_dashboard_v1`     | dashboard de operaciones caro + leído seguido + tolera staleness | matview (Fase 6) |
| `read_api.mv_risk_daily_metrics_v1`       | métricas diarias de riesgo por banda/modelo            | matview (Fase 6)  |
| `read_api.v_customer_devices_v1`          | detalle de dispositivos por cliente paginado           | vista (si hay overfetching medido) |
| `read_api.v_session_history_v1`           | histórico de sesiones por cliente por cursor           | vista (si hay overfetching medido) |

## Decisión de creación (checklist §19)

Una vista ayuda solo si simultáneamente: proyección explícita + filtro SQL + paginación SQL + índices
alineados + límite de payload + DTO pequeño. Si el backend hace `SELECT * FROM vista` y recorta en
Node.js, la vista no resuelve nada.
