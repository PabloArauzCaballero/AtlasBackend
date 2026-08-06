---
title: "Runbook — Readiness en 503"
type: "runbook"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
  - runbook
aliases: []
related: []
---
# Runbook — Readiness en 503

## Síntoma

El orquestador retira instancias; el tráfico no se atiende o se concentra en pocas réplicas.

## Señales de confirmación

```bash
curl -s -i http://<host>:3005/health/readiness
```

El cuerpo trae el detalle por dependencia:

```json
{ "status": "not_ready",
  "checks": { "postgres": "…", "postgresRead": "…", "redis": "…" },
  "shuttingDown": false }
```

## Diagnóstico por rama

| `checks` | Causa | Acción |
|---|---|---|
| `postgres: unreachable` | La base no responde dentro de `HEALTH_DB_PING_TIMEOUT_MS` | Revisar la base, la red y el pool |
| `redis: unreachable` | Redis configurado pero caído | Restablecer Redis |
| `shuttingDown: true` | La instancia está drenando | **Normal durante un despliegue** |
| `postgresRead` degradado | La réplica de lectura falla | **No causa el 503** — es informativo |

> [!info] Dos comportamientos que parecen bugs y no lo son
> 1. **Durante el apagado el readiness devuelve 503 de inmediato, sin consultar dependencias.** Es deliberado: la respuesta debe ser rápida y negativa, no depender de que PostgreSQL conteste.
> 2. **Una réplica de lectura caída NO produce 503.** También deliberado: es una dependencia compartida por todas las instancias; marcarla obligatoria sacaría del balanceador a todo el despliegue —incluidos auth y onboarding, que siguen sanos— convirtiendo una degradación parcial en caída total.

## Mitigación

- **PostgreSQL caído:** es un punto único de fallo; no hay degradación parcial. Restablecerlo.
- **Redis caído:** en producción es obligatorio. Restablecerlo; mientras tanto el rate limit y el liderazgo de jobs quedan comprometidos.
- **Todas las instancias drenando:** el despliegue está reemplazándolas. Si persiste, revisar que el orquestador da margen suficiente entre `SIGTERM` y `SIGKILL`.

## Verificación

`status: "ready"` y las instancias vuelven al balanceador.

## Prevención

- Alerta sobre readiness negativo sostenido (excluyendo ventanas de despliegue).
- Vigilar la saturación del pool: es la causa más común de que PostgreSQL "no responda" cuando en realidad está sano.

## Relaciones

- [[02-architecture/critical-sequences]] · [[10-operations/runbooks/pool-agotado]] · [[09-observability/observability-overview]]
