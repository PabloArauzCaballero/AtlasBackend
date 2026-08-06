---
title: "Trabajos programados"
type: "architecture"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - async
  - jobs
source_files:
  - "src/modules/runtime-jobs/scheduled-jobs.catalog.ts"
  - "src/modules/runtime-jobs/runtime-jobs-scheduler.service.ts"
  - "src/modules/runtime-jobs/job-tick-guard.ts"
aliases: []
related: []
---

# Trabajos programados

## Qué corre solo

9 jobs (8 siempre + 1 condicional), declarados en `buildScheduledJobs()`. Todos se ejecutan como `SCHEDULER_ACTOR` = `{ sub: 'runtime-jobs-scheduler', role: 'system' }`, lo que deja rastro en `system_job_runs` y en la auditoría de que el disparo vino del planificador y no de un operador.

| Job | Intervalo (variable) | Propósito |
|---|---|---|
| `process_outbox` | `RUNTIME_JOBS_OUTBOX_INTERVAL_MS` | Publica los eventos pendientes del outbox |
| `process_events` | `RUNTIME_JOBS_EVENTS_INTERVAL_MS` | Procesa eventos hacia sus consumidores |
| `expire_stale_sessions` | `RUNTIME_JOBS_SESSIONS_INTERVAL_MS` | Cierra sesiones inactivas más de `RUNTIME_JOBS_SESSION_MAX_IDLE_MINUTES` |
| `apply_retention_policies` | `RUNTIME_JOBS_RETENTION_INTERVAL_MS` | Aplica las políticas de retención de datos |
| `retry_stuck_notifications` | `RUNTIME_JOBS_NOTIFICATION_RETRY_INTERVAL_MS` | Reintenta notificaciones atascadas |
| `deliver_pending_notifications` | `RUNTIME_JOBS_NOTIFICATION_DELIVERY_INTERVAL_MS` | **Solo si** `NOTIFICATIONS_DELIVERY_MODE=deferred` |
| `purge_idempotency_keys` | `RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS` | Purga claves más antiguas que `RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS` (lote de 1 000) |
| `recalculate_data_quality` | `RUNTIME_JOBS_DATA_QUALITY_INTERVAL_MS` | Recalcula las métricas de calidad de datos |
| `reclaim_stuck_events` | `RUNTIME_JOBS_STUCK_EVENTS_INTERVAL_MS` | Rescata eventos atascados en `processing` |

> [!info] El job de entrega es condicional a propósito
> `deliver_pending_notifications` solo se registra si `NOTIFICATIONS_DELIVERY_MODE === 'deferred'`. Con entrega `inline`, la API entrega dentro del request; registrar el job además haría que *"competiría por los mismos mensajes que el proceso que acaba de crearlos"*.

## Catálogo separado de mecánica

`VERIFICADO` — la separación entre `scheduled-jobs.catalog.ts` (**qué** corre y **cada cuánto**) y `runtime-jobs-scheduler.service.ts` (**cómo** se ejecuta) está justificada en el propio código:

> *"esta lista es declarativa y cambia cada vez que aparece un trabajo de fondo nuevo, mientras que la mecánica de ejecución —liderazgo, reentrada, watchdog, apagado— cambia por motivos completamente distintos y mucho más raros. Mezclarlas hacía que cada job nuevo tocara el archivo donde viven las garantías de concurrencia."*

Consecuencia práctica: **añadir un job no debe tocar `runtime-jobs-scheduler.service.ts`**. Si un cambio necesita hacerlo, algo se está saliendo del patrón.

## `dryRun` invertido

Los DTO traen `dryRun: true` por defecto — para proteger el disparo manual desde HTTP, donde un error se paga caro. El planificador pasa `dryRun: false` **explícito** en cada job, porque su razón de ser es ejecutar.

Es un default seguro con una anulación deliberada y visible, en vez de un default peligroso.

## Concurrencia entre instancias

Varias réplicas de worker pueden convivir. `job-tick-guard.ts` y el planificador resuelven:

| Problema | Mecanismo |
|---|---|
| Dos instancias ejecutando el mismo job | Elección de líder (Redis) |
| Un tick que empieza antes de que acabe el anterior | Guardia de reentrada |
| Un job colgado | Watchdog |
| Apagado a mitad de un job | Integración con `GracefulShutdownService` |

`INFERIDO` — el detalle exacto del algoritmo de liderazgo no se extrajo; se deduce de la existencia de `job-tick-guard.ts`, de la dependencia de Redis y del comentario que enumera *"liderazgo, reentrada, watchdog, apagado"*.

## Disparo manual

Los mismos jobs se pueden disparar por HTTP a través de `runtime-jobs.controller.ts` (rol `system` y roles administrativos). Es el camino para reprocesar sin esperar al intervalo.

## Observabilidad

Cada ejecución se registra en `platform_ops.system_job_runs` mediante `job-run-recorder.service.ts`: qué job, cuándo, con qué resultado. Es la fuente para responder *"¿cuándo corrió por última vez y qué hizo?"*.

Ver [[09-observability/metrics]] y [[10-operations/runbooks/worker-detenido]].

## Riesgo: el intervalo es el único techo

`RIESGO` — todos los jobs se agendan **por intervalo**, no por expresión cron. No hay ventana horaria: `apply_retention_policies` y `recalculate_data_quality` pueden caer en hora punta. Para cargas pesadas conviene revisar si el intervalo configurado en producción evita el solapamiento con el pico de tráfico.

## Relaciones

- [[07-async-processing/workers]] · [[07-async-processing/ordering-and-concurrency]] · [[02-architecture/runtime-topology]]
