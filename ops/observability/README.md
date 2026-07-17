# Observabilidad — dashboards y alertas (Fase 3.4)

Config lista para operar los SLOs de AtlasBackend a partir de las métricas que expone
`GET /metrics` (`MetricsService`). No requiere código: son artefactos de Prometheus/Grafana.

| Archivo | Qué es |
|---------|--------|
| [`prometheus-alerts.yml`](prometheus-alerts.yml) | Reglas de alerta (error 5xx, p95/p99, target down, event loop lag) |
| [`grafana-dashboard.json`](grafana-dashboard.json) | Dashboard "AtlasBackend — SLOs HTTP" (importable) |

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

## Pendiente (métricas de negocio)

El dashboard cubre los SLOs **HTTP**, que es lo que hoy instrumenta el interceptor. Las señales de
negocio que el plan también pide — **profundidad del outbox**, **circuit breaker abierto** y **costo
por proveedor externo** — requieren instrumentar counters/gauges propios en esos servicios
(outbox despachador, `ResilientAdapterExecutorService`, `ExternalDataDecisionService`) y exponerlos
por el mismo `MetricsService`. Es el siguiente incremento de la Fase 3.4.
