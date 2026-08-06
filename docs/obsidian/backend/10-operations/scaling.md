---
title: "Escalado"
type: "runbook"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
aliases: []
related: []
---
# Escalado

## La aritmética que manda

> [!warning] Antes de añadir una réplica
> **(réplicas × `DB_POOL_MAX`) ≤ `CONNECTION LIMIT` del rol `atlas_app_rw`**
>
> Con el default de 20 y un límite de 100, el techo son **5 instancias**. La sexta no falla al arrancar: agota las conexiones del servidor y degrada a **todas**. El síntoma aparece lejos de la causa.
>
> Verificable con `yarn check:db-privileges`.

## Por componente

| Componente | Escalado | Efecto real |
|---|---|---|
| `api` | Horizontal | Lineal, hasta el techo del pool |
| `worker` | Horizontal | **Disponibilidad, no throughput** — solo el líder ejecuta cada job |
| PostgreSQL | Vertical + réplicas de lectura | Un solo primario para escritura |
| Redis | Instancia única | — |

## Acelerar el trabajo de fondo

Añadir workers **no** acelera un job: lo ejecuta el líder. Las palancas reales:

| Palanca | Efecto | Riesgo |
|---|---|---|
| `RUNTIME_JOBS_BATCH_LIMIT` ↑ | Más filas por tick | Más presión sobre el pool |
| `RUNTIME_JOBS_*_INTERVAL_MS` ↓ | Ticks más frecuentes | Ídem |

## Descargar lecturas

`DB_READ_ENABLED` + `DB_READ_POOL_MAX` envían los listados a una réplica y a un pool aparte. Aporta capacidad de lectura sin tocar el pool de escritura.

Recordar: la réplica de lectura **no decide el readiness**, a propósito.

## Antes de escalar, medir

```bash
yarn db:capture-query-baseline
yarn db:extract-read-workload
```

Escalar sin baseline puede estar tapando un problema de índices — ver [[14-audits/risks-register|PERF-001]]. Añadir réplicas contra una consulta sin índice multiplica la carga en vez de repartirla.

## Límites conocidos

| Límite | Valor |
|---|---|
| Cuerpo de petición | `API_JSON_BODY_LIMIT` = 2 MB |
| Página de listado | `limit` máximo 100 |
| Rate limit | `API_RATE_LIMIT_MAX` por `API_RATE_LIMIT_TTL_MS` |
| Adquisición del pool | `DB_POOL_ACQUIRE_MS` = 30 s |

## Relaciones

- [[10-operations/runbooks/pool-agotado]] · [[05-data/data-stores]] · [[02-architecture/deployment-topology]]
