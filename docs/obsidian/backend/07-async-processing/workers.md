---
title: "Workers"
type: "architecture"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - async
aliases: []
related: []
---
# Workers

## Qué es un worker en Atlas

**El mismo artefacto que la API, con otro entrypoint.** No hay una base de código de workers.

| | |
|---|---|
| Entrypoint | `dist/src/worker.js` |
| `APP_ROLE` | `worker` o `all` |
| Arranque | `createApplicationContext()` — providers sí, rutas no |
| Expone | Solo `/health/liveness`, `/health/readiness`, `/metrics` en `WORKER_PROBE_PORT` |
| Ejecuta | 9 jobs programados + monitor de salud + seed de arranque |

Detalle en [[02-architecture/runtime-topology]].

## Servicios de fondo

| Servicio | Responsabilidad |
|---|---|
| `RuntimeJobsSchedulerService` | Ejecuta el catálogo de jobs; liderazgo, reentrada, watchdog |
| `SystemsHealthMonitorService` | Vigila la salud del sistema |
| `StartupSeedService` | Siembra lo mínimo al arrancar |

Arrancan solos porque `runsBackgroundWork()` es verdadero — no hay registro explícito en `worker.ts`.

## Escalado

Varias réplicas pueden convivir: el liderazgo evita ejecución duplicada. Aumentar réplicas da **disponibilidad**, no throughput proporcional: si solo el líder ejecuta un job, añadir workers no lo acelera.

Para acelerar el procesamiento hay que subir `RUNTIME_JOBS_BATCH_LIMIT` o bajar el intervalo, vigilando el pool de conexiones.

## Apagado

El orden importa: readiness pasa a 503 **antes** de cerrar el contexto, para que el orquestador retire la instancia mientras los módulos siguen vivos. Ver [[10-operations/startup-shutdown]].

## Observabilidad

Cada ejecución queda en `platform_ops.system_job_runs`. Prometheus hace scrape del puerto 3006.

## Relaciones

- [[07-async-processing/schedulers]] · [[02-architecture/runtime-topology]] · [[10-operations/runbooks/worker-detenido]]
