---
title: "SLO, SLI y SLA"
type: "reference"
status: "draft"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - observability
aliases: []
related: []
---
# SLO, SLI y SLA

> [!question] Pendiente — no definidos
> No hay SLO, SLI ni SLA en el repositorio. Sin ellos, las alertas no tienen umbral objetivo y "el sistema va bien" no es verificable.

## Indicadores que ya se pueden medir

El instrumental existe; falta el objetivo.

| SLI candidato | Fuente | Disponible hoy |
|---|---|---|
| Disponibilidad de la API | Tasa de 2xx/3xx sobre el total | ✅ `HttpMetricsInterceptor` |
| Latencia por ruta | Histograma | ✅ ídem |
| Tasa de error por ruta | 5xx / total | ✅ ídem |
| Frescura del outbox | Antigüedad del `pending` más viejo | ⚠️ consultable en BD, no en Prometheus |
| Puntualidad de jobs | Retraso frente al intervalo | ⚠️ en `system_job_runs` |
| Disponibilidad de proveedores | `provider_health_logs` | ⚠️ en BD |

Los marcados ⚠️ requieren exportarlos como métrica para poder alertar.

## Qué habría que decidir

- [ ] Objetivo de disponibilidad de la API
- [ ] Objetivo de latencia (percentil y umbral)
- [ ] Frescura máxima aceptable de eventos — **depende del negocio**, no de la técnica
- [ ] Ventana de medición y presupuesto de error
- [ ] Si hay compromiso externo (SLA) o solo interno (SLO)

> [!info] El objetivo de frescura de eventos es una decisión de producto
> El outbox garantiza que el evento **no se pierde**, no que llegue pronto: la latencia la fija el intervalo del job. Cuánta demora es aceptable en, por ejemplo, una notificación de KYC aprobado, lo decide negocio — y de esa decisión sale el intervalo, no al revés.

## Relaciones

- [[09-observability/alerts]] · [[09-observability/metrics]] · [[07-async-processing/events]]
