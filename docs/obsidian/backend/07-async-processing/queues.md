---
title: "Colas"
type: "architecture"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - async
aliases: []
related: []
---
# Colas

## No hay broker de mensajería

`VERIFICADO` — no aparece Kafka, RabbitMQ, SQS ni BullMQ en `package.json`. La única "cola" es una **tabla de PostgreSQL**: `platform_ops.outbox_events`.

| Propiedad | Con broker | Con outbox en PostgreSQL |
|---|---|---|
| Atomicidad con el cambio de negocio | No — ventana de pérdida entre `COMMIT` y `publish` | **Sí** — misma transacción |
| Latencia de entrega | Milisegundos | Un intervalo de job |
| Operación | Un sistema más que desplegar y vigilar | Ninguno |
| Throughput | Alto | Limitado por PostgreSQL |
| Orden | Configurable por partición | No garantizado entre agregados |

La decisión y sus alternativas: [[02-architecture/adr/0001-outbox-en-postgresql|ADR-0001]].

## Cómo se consume

Por *polling*: los jobs `process_outbox` y `process_events` reclaman lotes de `RUNTIME_JOBS_BATCH_LIMIT` filas y las marcan `processing`. No hay *push* ni suscripción.

## Qué vigilar

| Síntoma | Significado |
|---|---|
| `pending` crece sin parar | El worker no corre, o el intervalo no da abasto |
| `processing` con filas antiguas | Un proceso murió a mitad; debería rescatarlas `reclaim_stuck_events` |
| `failed` crece | Los consumidores rechazan; revisar la causa antes de reintentar |
| La tabla crece sin límite | Sin purga de `processed` — ver [[05-data/retention-and-deletion]] |

## Relaciones

- [[07-async-processing/events]] · [[07-async-processing/retry-and-dead-letter]] · [[outbox_events]]
