# Observabilidad — dashboards y alertas (Fase 3.4)

Config lista para operar los SLOs de AtlasBackend a partir de las métricas que expone
`GET /metrics` (`MetricsService`). No requiere código: son artefactos de Prometheus/Grafana.

| Archivo                                            | Qué es                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`prometheus-alerts.yml`](prometheus-alerts.yml)   | 9 reglas: SLOs HTTP (error 5xx, p95/p99, target down) + negocio (breaker abierto, backlog de outbox, fallo por proveedor) + event loop |
| [`grafana-dashboard.json`](grafana-dashboard.json) | Dashboard "AtlasBackend — SLOs HTTP" (importable)                                                                                      |

## Scrape

AtlasBackend expone `/metrics` **fuera** del prefijo `/api/v1` (convención Prometheus). Ejemplo de
`scrape_config` (restringe el acceso a la red interna — el endpoint no lleva auth de aplicación):

```yaml
scrape_configs:
  - job_name: atlas-backend
    metrics_path: /metrics
    static_configs:
      - targets: ['atlas-backend:3005']
```

> El `job_name: atlas-backend` debe coincidir con el usado en la alerta `AtlasBackendTargetDown`
> (`up{job="atlas-backend"}`).

## Alertas

Referencia el archivo de reglas en `prometheus.yml`:

```yaml
rule_files:
  - /etc/prometheus/rules/prometheus-alerts.yml
```

Umbrales de partida (ajústalos al SLO acordado): error 5xx > 5% (crítico), p95 > 1s (warning),
p99 > 2.5s (crítico), target down > 2m (crítico).

## Dashboard

Grafana → **Dashboards → Import → Upload JSON** → selecciona `grafana-dashboard.json` y la fuente de
datos Prometheus. Paneles: tasa de error (SLI), throughput, p95, event loop lag, percentiles
p50/p95/p99, requests por clase de estado y top rutas por latencia.

## Métricas de negocio

Además de los SLOs HTTP, se exponen las tres señales de negocio que pide el plan:

| Métrica                                        | Origen                                                                                                                                                              | Alerta                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `atlas_circuit_breaker_state{provider}`        | `ResilientAdapterExecutorService` (0=closed, 1=half_open, 2=open)                                                                                                   | `AtlasCircuitBreakerOpen` (== 2)      |
| `atlas_provider_calls_total{provider,outcome}` | `ResilientAdapterExecutorService` — `success` / `failure` / `circuit_open`. Proxy del **costo**: cada llamada a un buró/KYC se cobra; `circuit_open` **no** cuesta. | `AtlasProviderFailureRateHigh` (>20%) |
| `atlas_outbox_pending_events{tenant_id}`       | `RuntimeJobsService.processOutbox` — profundidad del backlog medida en cada corrida del job                                                                         | `AtlasOutboxBacklogGrowing` (>1000)   |

> El gauge del outbox se actualiza **cuando corre el job** `process-outbox`, no en cada scrape (evita
> una query a PostgreSQL por scrape). Si el job deja de correr, el gauge se queda estancado — por eso
> `AtlasOutboxBacklogGrowing` usa `for: 10m` y conviene complementarlo con una alerta de
> "el job no corrió" desde el scheduler que lo dispara.
