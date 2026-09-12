# Auditoría HTTP frente a outbox de dominio (AT-037)

Prueba de contrato: `test/contracts/runtime/http-audit-vs-domain-outbox.spec.ts`.

## Qué es cada cosa

| | Evento técnico `*_completed` | Evento de dominio |
|---|---|---|
| Quién lo escribe | `ApiCommandOutboxInterceptor`, después de que el handler respondió | el caso de uso, dentro de la transacción del agregado (AT-033) |
| Cuándo existe | cuando la mutación HTTP terminó sin excepción | cuando la transacción de negocio se confirmó |
| Qué dice | «se ejecutó `POST /api/v1/...` con rol X» | «la solicitud CRA-1 fue presentada por el cliente 42» |
| Transaccional con el negocio | **no** (y no debe serlo: es telemetría) | **sí** |
| Consumidores | `process_outbox` (lo marca procesado), catálogo de flujos (`systems-ops`, que lo excluye del linaje) | consumidores registrados por tipo |
| `producer` / `event_family` | `http-audit` / `api_audit` (desde AT-037) | el módulo dueño / `domain` |

## Semántica de fallo (declarada)

1. **Mutación confirmada + fallo al escribir la auditoría técnica**: la respuesta al cliente es el error de la escritura
   (comportamiento previo, conservado: «una mutación con clave de idempotencia debe quedar registrada antes de responder»).
   El negocio ya está confirmado y la clave de idempotencia lleva el resultado: el cliente **recupera por clave**
   (replay) en vez de reejecutar. No hay duplicación.
2. **Replay de idempotencia**: el interceptor de idempotencia responde antes de `next.handle()`, así que el interceptor
   de outbox **no corre**: no hay segundo evento técnico ni, por supuesto, segundo evento de dominio (el caso de uso no
   se ejecutó). El intento queda en el log de acciones HTTP (`HttpActionLogInterceptor`, que envuelve al de idempotencia).
3. **Rollback de negocio** (`ApplicationError`, excepción): `next.handle()` falla → el interceptor de outbox no escribe
   nada → no existe evento técnico de éxito; y el evento de dominio, escrito en la transacción, se revierte con ella.

Orden de interceptores (sin cambios): métricas → timeout → action-log → idempotencia → outbox técnico → respuesta.

## Lo que NO se hace

No se retira el evento técnico: `systems-ops` lo excluye explícitamente del linaje (`aggregate_type <> 'api_command'`) y
`process_outbox` lo cierra; ambos siguen igual. Lo que cambia es que ya no es la única fuente de «hechos»: los eventos
críticos los escribe el caso de uso.
