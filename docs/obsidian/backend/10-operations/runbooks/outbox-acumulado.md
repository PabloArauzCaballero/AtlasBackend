---
title: "Runbook — Outbox acumulado"
type: "runbook"
status: "verified"
owner: "unknown"
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
# Runbook — Outbox acumulado

## Síntoma

Los eventos de dominio no llegan a sus consumidores: notificaciones que no salen, integraciones que no reaccionan.

## Señales de confirmación

```sql
SELECT status, COUNT(*), MIN(_created_at) AS mas_antiguo
FROM platform_ops.outbox_events
GROUP BY status;
```

## Diagnóstico por estado

| Estado acumulado | Significado | Acción |
|---|---|---|
| `pending` | Nadie los está drenando | ¿Corre el worker? → [[10-operations/runbooks/worker-detenido]] |
| `processing` **antiguo** | Un proceso murió a mitad | ¿Corre `reclaim_stuck_events`? |
| `failed` | Presupuesto de intentos agotado (`max_attempts`, 3 por defecto) | Revisar `error_code` y `last_error` **antes** de reintentar |

> [!danger] `processing` antiguo es el caso grave
> Ninguna consulta de reclamo mira ese estado: sin `reclaim_stuck_events` esos eventos **se pierden en silencio**. Si se acumulan, ese job no está corriendo — es la prioridad.

## Mitigación

- **`pending` creciendo:** restablecer el worker. Si el ritmo no da abasto, subir `RUNTIME_JOBS_BATCH_LIMIT` o bajar `RUNTIME_JOBS_OUTBOX_INTERVAL_MS`, vigilando el pool.
- **`processing` atascado:** verificar que `reclaim_stuck_events` corre y revisar `RUNTIME_JOBS_STUCK_EVENT_MINUTES`.
- **`failed`:** es la **dead-letter**, y nada la vacía sola. Diagnosticar con `error_code` y `last_error`; los rescatados por expiración de bloqueo llevan `EVENT_LOCK_EXPIRED`. Reintentar sin corregir la causa solo repite el fallo.

```sql
-- por qué murieron
SELECT error_code, COUNT(*), MAX(failed_at) AS ultimo
FROM platform_ops.outbox_events
WHERE status = 'failed'
GROUP BY error_code ORDER BY 2 DESC;
```

## Verificación

`pending` decrece, `processed` crece, y no hay `processing` más antiguo que el umbral configurado.

## Prevención

- Alerta sobre la **antigüedad** del `pending` más viejo (mejor señal que el recuento).
- Alerta sobre cualquier `processing` que supere el umbral de rescate.
- Vigilar el crecimiento total de la tabla: ver [[05-data/retention-and-deletion]], donde se registra que **no se detectó purga de `processed`**.

## Relaciones

- [[07-async-processing/events]] · [[07-async-processing/retry-and-dead-letter]] · [[outbox_events]]
