---
title: "Reintentos y mensajes muertos"
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
# Reintentos y mensajes muertos

## Dos ámbitos distintos

| Ámbito | Mecanismo |
|---|---|
| **Llamadas externas** | Circuit breaker + reintentos con backoff (`common/resilience/`) |
| **Eventos y notificaciones** | Estado persistido + jobs de rescate |

## Llamadas a proveedores externos

`ResilientAdapterExecutorService` envuelve toda llamada saliente:

| Pieza | Archivo |
|---|---|
| Circuit breaker | `circuit-breaker.ts` |
| Reintentos con backoff | `retry.util.ts` |
| Error tipado de adaptador | `adapter-error.ts` |
| Validación de configuración | `provider-config-validator.ts` |

El circuit breaker evita el patrón destructivo: reintentar contra un proveedor caído multiplica la carga sobre él y agota los propios recursos esperando timeouts.

## Eventos

No hay *dead letter queue* como tal. El equivalente es el estado en la tabla:

```
pending → processing → processed
                    ↘ failed        ← el "dead letter" de Atlas
```

Un evento en `failed` queda visible y reintentable, sin desaparecer.

> [!warning] El estado peligroso es `processing`, no `failed`
> `failed` es un fallo **conocido**: está registrado y alguien puede actuar. `processing` tras la muerte del proceso es un fallo **invisible**: ninguna consulta de reclamo mira ese estado.
>
> `reclaim_stuck_events` cierra ese agujero rescatando los que superan `RUNTIME_JOBS_STUCK_EVENT_MINUTES`. Sin ese job, la pérdida sería silenciosa.

## Notificaciones

Dos jobs complementarios:

| Job | Qué rescata |
|---|---|
| `retry_stuck_notifications` | Las que llevan más de `RUNTIME_JOBS_NOTIFICATION_STUCK_MINUTES` sin resolverse |
| `deliver_pending_notifications` | Las pendientes, solo en modo `deferred` |

El estado por destinatario vive en `messaging.notification_deliveries`: se puede saber qué canal falló para quién, no solo que "la notificación falló".

## Idempotencia obligatoria en el consumidor

La entrega es **al menos una vez**: un fallo tras entregar y antes de marcar `processed` reentrega. Todo consumidor debe tolerar duplicados. Ver [[07-async-processing/idempotency]].

## Relaciones

- [[07-async-processing/events]] · [[06-integrations/index]] · [[10-operations/runbooks/index]]
