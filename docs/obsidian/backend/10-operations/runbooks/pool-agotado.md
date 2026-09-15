---
title: "Runbook — Pool de conexiones agotado"
type: "runbook"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
  - runbook
aliases: []
related: []
---
# Runbook — Pool de conexiones agotado

## Síntoma

Latencia alta y timeouts **sin que ninguna consulta concreta sea lenta**. Errores de adquisición tras `DB_POOL_ACQUIRE_MS` (30 s por defecto). El readiness puede empezar a fallar.

## Por qué despista

El tiempo no se va en ejecutar SQL: se va **esperando una conexión libre**. Las métricas por consulta se ven normales; lo que está saturado es el pool.

## Señales de confirmación

- Métricas de `DbPoolMetricsService`: conexiones en uso ≈ `DB_POOL_MAX`.
- Errores de timeout de adquisición en el log.
- En PostgreSQL: `SELECT count(*) FROM pg_stat_activity WHERE usename = '<rol de runtime>';`

## La causa más común

> [!warning] La aritmética que hay que revisar antes de escalar
> **(réplicas × `DB_POOL_MAX`) ≤ `CONNECTION LIMIT` del rol `atlas_app_rw`**
>
> Escalar réplicas sin revisar este producto agota las conexiones del **servidor**, no del pool. El síntoma aparece lejos de la causa: se añadió una réplica y "empezó a ir lento todo".
>
> Verificable con `yarn check:db-privileges`. Ver `docs/database/postgres-roles.md`.

## Otras causas

| Causa | Indicio |
|---|---|
| Consultas lentas ocupando conexiones | Alguna consulta con duración anómala |
| Fuga de transacciones | Conexiones `idle in transaction` en `pg_stat_activity` |
| Job con lote muy grande | `RUNTIME_JOBS_BATCH_LIMIT` alto coincidiendo con el pico |
| Falta de índice forzando *scan* | Ver [[14-audits/risks-register\|PERF-001]] |

## Mitigación inmediata

1. Reducir réplicas, o subir el `CONNECTION LIMIT` del rol si el servidor lo admite.
2. Terminar conexiones `idle in transaction` antiguas.
3. Bajar temporalmente `RUNTIME_JOBS_BATCH_LIMIT` si coincide con un job pesado.

## Recuperación

Ajustar `DB_POOL_MAX`, `DB_POOL_MIN` y el número de réplicas de forma coherente con el límite del rol. Considerar activar `DB_READ_ENABLED` para descargar las lecturas a un pool aparte.

## Prevención

- Alerta sobre saturación del pool antes de que sature.
- Capturar el baseline: `yarn db:capture-query-baseline` y `yarn db:extract-read-workload`.
- Revisar la aritmética del pool **en cada cambio de escala**.

## Relaciones

- [[05-data/data-stores]] · [[10-operations/scaling]] · [[14-audits/risks-register]]
