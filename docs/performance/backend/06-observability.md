# Observabilidad para diagnosticar rendimiento

Este documento cubre **qué señales existen hoy y cuáles faltan para atribuir latencia a una causa**.
La visión general de observabilidad vive en [`docs/observability/overview.md`](../../observability/overview.md);
aquí sólo el ángulo de rendimiento.

## Lo que ya se publica

Todo en `GET /metrics`, excluido del prefijo `API_PREFIX` (`src/main.ts:72`) para respetar la
convención de scrape de Prometheus.

| Serie | Origen | Para qué sirve al diagnosticar |
|---|---|---|
| `http_request_duration_seconds` | `metrics.service.ts:50` | p50/p95/p99 por ruta vía `histogram_quantile` |
| `http_requests_total` | `metrics.service.ts:43` | Tasa de error por ruta vía `rate` |
| `atlas_db_pool_connections{state}` | `db-pool-metrics.service.ts:49` | `waiting > 0` sostenido = el cuello es el pool, no las queries |
| `nodejs_eventloop_lag_p99_seconds` | `collectDefaultMetrics` | Trabajo CPU-bound bloqueando el hilo |
| `nodejs_heap_size_used_bytes`, `process_resident_memory_bytes` | `collectDefaultMetrics` | Crecimiento sostenido = fuga |
| `atlas_provider_calls_total` | `metrics.service.ts:62` | Volumen y coste de proveedores externos |
| `atlas_circuit_breaker_state` | `metrics.service.ts:69` | `== 2` abierto: latencia que en realidad es un breaker |
| `atlas_outbox_pending_events` | `metrics.service.ts:76` | Profundidad del backlog |
| `atlas_scheduled_job_runs_total` | `metrics.service.ts:86` | `outcome="stalled"` = job que dejó de correr |
| `atlas_app_info{role}` | `metrics.service.ts:107` | `absent(...{role="worker"})` = worker caído |

Trazas: OpenTelemetry con exportación OTLP/HTTP, arrancado antes que cualquier módulo instrumentable
(`src/main.ts:9`) para poder envolver HTTP/Express/PG. Es no-op salvo `OTEL_ENABLED=true`.

## Huecos, y qué riesgo dejan sin confirmar

Ninguno se cerró en este trabajo: instrumentar es la Fase B del
[plan](03-optimization-plan.md), y se hace justo antes de atacar el riesgo correspondiente, no antes
de tener baseline.

| Hueco | Riesgo que no se puede confirmar sin él | Cardinalidad |
|---|---|---|
| Duración y conteo de llamadas a AWS KMS (`kms-key-provider.ts:80`) | R-02: ¿una data key por lote o una por fila? | Baja: sin etiquetas por valor |
| Duración de query de Postgres como serie propia | Separar «query lenta» de «espera de pool» sin abrir una traza | Baja: por operación, nunca el SQL |
| Duración de las transacciones de ingesta | R-03: retención de locks | Baja |
| `process_open_fds` bajo inferencia | R-04: techo de descriptores | Ninguna: ya la publica `collectDefaultMetrics` en Linux |

## Reglas de cardinalidad

No usar como etiquetas de métrica: identificadores de usuario, de cliente o de tenant en series de
alta frecuencia, URLs crudas, SQL completo, mensajes libres. Cada valor distinto crea una serie
temporal nueva y el coste crece sin techo.

`atlas_outbox_pending_events` sí lleva `tenant_id`, y es una excepción deliberada: es un gauge que se
escribe una vez por corrida de job, no por petición.

Los logs son estructurados y pasan por `redactSensitiveObject` / `redactSensitiveText`. Nunca se
loguea SQL: Sequelize inlinea los valores y eso filtraría PII en un backend KYC.

## Consultas PromQL para el diagnóstico

```promql
# p95 por ruta
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))

# ¿El cuello es el pool? Si esto es > 0 sostenido, sí.
atlas_db_pool_connections{state="waiting"}

# Saturación del pool: fracción en uso
atlas_db_pool_connections{state="using"} / atlas_db_pool_connections{state="size"}

# Tasa de error 5xx
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Event loop bloqueado
nodejs_eventloop_lag_p99_seconds > 0.1
```

## Cómo lo usa el arnés de carga

`scripts/perf/lib/metrics-probe.ts` lee `/metrics` al inicio y al final de cada corrida y adjunta al
informe: heap, RSS, event-loop lag y ocupación del pool. Es la diferencia entre «el p95 subió» y «el
p95 subió porque el pool estaba agotado».

Si una serie esperada no aparece, se registra en `missingSeries` del informe. Una serie ausente es un
hueco de observabilidad, no un cero: rellenarla con cero produciría un informe que afirma algo que
nadie midió.
