---
title: "Orden y concurrencia"
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
# Orden y concurrencia

## Garantías de orden

| Ámbito | Garantía |
|---|---|
| Entre agregados distintos | **Ninguna** |
| Dentro de un agregado | `NO_CONFIRMADO` — depende del criterio de reclamo del lote |
| Entre jobs distintos | Ninguna: cada uno tiene su propio intervalo |

> [!warning] No construir lógica que dependa del orden de eventos
> `process_outbox` reclama lotes; nada garantiza que dos eventos del mismo cliente se procesen en el orden en que se escribieron. Un consumidor que asuma "primero llega `kyc.submitted` y luego `kyc.approved`" fallará de forma intermitente.
>
> La forma robusta es que el evento lleve el estado necesario, o que el consumidor consulte el estado actual en vez de reconstruirlo por secuencia.

## Concurrencia entre workers

| Riesgo | Mecanismo |
|---|---|
| Dos instancias ejecutan el mismo job | Elección de líder (Redis) |
| Un tick empieza antes de acabar el anterior | Guardia de reentrada (`job-tick-guard.ts`) |
| Un job se cuelga | Watchdog |
| Dos workers toman el mismo evento | Reclamo `pending → processing` |

## Concurrencia en la API

| Mecanismo | Para qué |
|---|---|
| Transacciones PostgreSQL | Atomicidad del cambio + su evento |
| Claves de idempotencia | Comandos duplicados del cliente |
| Restricciones únicas | Última línea de defensa ante carreras |
| Rate limiting con almacén Redis | Contador compartido entre instancias |

`NO_CONFIRMADO` — no se detectó bloqueo optimista con columna de versión ni uso de ETags. El control de concurrencia recae en las transacciones y en las restricciones únicas.

## Contención

Los puntos donde varias instancias compiten:

1. **Pool de conexiones** — (réplicas × `DB_POOL_MAX`) contra el límite del rol.
2. **Reclamo del outbox** — varios workers sobre la misma tabla.
3. **Redis** — instancia única para límites y liderazgo.

## Relaciones

- [[07-async-processing/schedulers]] · [[07-async-processing/idempotency]] · [[05-data/data-stores]]
