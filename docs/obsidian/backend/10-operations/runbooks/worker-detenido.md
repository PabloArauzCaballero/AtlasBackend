---
title: "Runbook — Worker detenido"
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
# Runbook — Worker detenido

## Síntoma

Los eventos no se publican, las sesiones no expiran, la retención no se aplica. **Sin error visible para ningún usuario**: el trabajo simplemente no ocurre.

## Impacto

Alto y creciente. La cola de `outbox_events` en `pending` crece; las notificaciones no salen; los datos que debían purgarse permanecen.

## Señales de confirmación

```bash
curl -s http://<host>:3006/health/readiness      # ¿responde la sonda?
```

```sql
-- ¿cuándo corrió cada job por última vez?
SELECT job_code, MAX(_created_at) AS ultima
FROM platform_ops.system_job_runs
GROUP BY job_code ORDER BY ultima;

-- ¿se acumula el outbox?
SELECT status, COUNT(*) FROM platform_ops.outbox_events GROUP BY status;
```

## Diagnóstico

1. **¿El proceso vive?** Sin respuesta en 3006, el contenedor está caído o no arrancó.
2. **¿`APP_ROLE` es correcto?** Con `api` el worker **sale con código 1** al arrancar — a propósito. Revisar el log de arranque: dice exactamente eso.
3. **¿Arrancó y falló después?** Buscar `unhandledRejection` / `uncaughtException` en el log: los handlers globales registran el stack y salen con código ≠ 0.
4. **¿Está drenando?** Si `shuttingDown` es `true` en el readiness, está apagándose y no toma trabajo nuevo.
5. **¿Hay líder?** Con varias réplicas, solo el líder ejecuta. Si el liderazgo depende de Redis y Redis no responde, puede que **ninguna** réplica se considere líder.
6. **¿Está el pool agotado?** Ver [[10-operations/runbooks/pool-agotado]].

## Mitigación inmediata

- Reiniciar el contenedor del worker.
- Si es un problema de rol, corregir `APP_ROLE` y redesplegar.
- Si Redis es la causa, restablecerlo: sin él no hay elección de líder.

## Recuperación

Los jobs son recuperables por diseño: al arrancar, `process_outbox` retoma los `pending` y `reclaim_stuck_events` rescata los que quedaron en `processing`.

Si hay muchos acumulados, considerar subir temporalmente `RUNTIME_JOBS_BATCH_LIMIT` o bajar el intervalo — **vigilando el pool de conexiones**.

## Verificación

```sql
SELECT status, COUNT(*) FROM platform_ops.outbox_events GROUP BY status;
```

`pending` debe decrecer y `processed` crecer.

## Prevención

- Alerta sobre la antigüedad del `pending` más viejo del outbox.
- Alerta si un `job_code` no registra ejecución en N intervalos.
- Vigilar que `reclaim_stuck_events` corre: es la red que evita la pérdida silenciosa.

## Relaciones

- [[07-async-processing/schedulers]] · [[07-async-processing/workers]] · [[10-operations/runbooks/outbox-acumulado]]
