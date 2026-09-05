---
title: "Alertas"
type: "reference"
status: "draft"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - observability
aliases: []
related: []
---
# Alertas

> [!question] Pendiente — no hay reglas de alerta en el repositorio
> No existen definiciones versionadas (Prometheus rules, Alertmanager, etc.). Esta nota propone qué vigilar, derivado de los modos de fallo documentados. **No describe lo que hay configurado hoy.**

## Alertas propuestas

### Críticas

| Señal | Condición | Por qué |
|---|---|---|
| Readiness negativo | Sostenido fuera de ventana de despliegue | Instancias fuera del balanceador |
| PostgreSQL inalcanzable | `checks.postgres = unreachable` | Punto único de fallo |
| Saturación del pool | En uso ≈ `DB_POOL_MAX` | Latencia alta sin consultas lentas |
| Ningún job ejecutado | Un `job_code` sin registro en N intervalos | El trabajo de fondo se detuvo **en silencio** |
| Eventos en `processing` antiguos | Superan el umbral de rescate | Pérdida silenciosa si `reclaim_stuck_events` no corre |

### Importantes

| Señal | Condición |
|---|---|
| Antigüedad del outbox | El `pending` más viejo supera N minutos |
| Tasa de 5xx | Por encima del umbral por ruta |
| Circuito abierto | Por proveedor externo |
| Redis inalcanzable | En producción |
| Fallos de autenticación | Pico anómalo — posible fuerza bruta |
| 429 | Pico anómalo |

## Principio de diseño

> [!info] Alertar sobre antigüedad, no sobre recuento
> Un outbox con 10 000 `pending` procesándose a buen ritmo está sano; uno con 50 `pending` donde el más viejo tiene 3 horas, no. La **antigüedad del más viejo** detecta el atasco; el recuento detecta el volumen, que es otra cosa.

Lo mismo aplica a los jobs: importa *cuándo corrió por última vez*, no cuántas veces corrió.

## Lo que hace difícil alertar bien hoy

Sin SLO definidos no hay umbral objetivo: cualquier valor sería arbitrario. Definir los SLO es el paso previo. Ver [[09-observability/slo-sli-sla]].

## Relaciones

- [[09-observability/metrics]] · [[10-operations/runbooks/index]]
