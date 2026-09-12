---
title: "Reintentos y mensajes muertos"
type: "architecture"
status: "verified"
owner: "@PabloArauzCaballero"
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

## Eventos: presupuesto de intentos y dead-letter real

`VERIFICADO` — el outbox implementa un modelo de reintentos completo, no un simple estado. Evidencia: `src/modules/events/outbox-queries.constants.ts`.

| Columna | Papel |
|---|---|
| `attempts` | Se incrementa **al reclamar**, no al fallar |
| `max_attempts` | Presupuesto; **por defecto 3** (`COALESCE(max_attempts, 3)`) |
| `available_at` | Cuándo vuelve a ser elegible — es el mecanismo de backoff |
| `locked_at` / `locked_by` | Quién lo tiene y desde cuándo |
| `error_code` / `last_error` / `failed_at` | Por qué murió |

```
pending → processing → processed
   ↑            ↓
   └── reclaim ─┤  quedan intentos → vuelve a pending, available_at = ahora
                └─ agotados        → failed  (dead-letter)
```

> [!info] `failed` **es** la dead-letter, y es explícita
> El comentario del código no deja lugar a dudas: *"si quedan intentos vuelve a `pending` disponible ahora; si no, cae a `failed`, que es el estado de dead-letter del que un operador lo saca a mano. **Nunca se pierde: cambia de cola**."*
>
> Detalle fino: en la rama de dead-letter **no** se pisa `available_at`, porque ese valor es evidencia de cuándo el evento debió procesarse. En la rama que reencola sí se actualiza.

Un evento rescatado queda con `error_code = 'EVENT_LOCK_EXPIRED'` y un `last_error` que explica el porqué a quien lo audite.

> [!warning] El estado peligroso es `processing`, no `failed`
> `failed` es un fallo **conocido**: está registrado, tiene causa y alguien puede actuar. `processing` tras la muerte del proceso es un fallo **invisible**: la consulta de reclamo solo mira `pending`.
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
