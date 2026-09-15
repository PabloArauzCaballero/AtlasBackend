# Almacenamiento de mensajería: outbox con sobre e inbox por consumidor (AT-022)

Migración `20260911190000-outbox-envelope-and-inbox-receipts.ts` (expansiva, reversible). Prueba:
`test/integration/events/outbox-schema-upgrade.spec.ts`. Modelos: `OutboxEventModel` (columnas nuevas), `InboxReceiptModel`.

## Qué había

`platform_ops.outbox_events` con estado (`pending`/`processing`/…), `attempts`, `locked_at`/`locked_by`, `available_at`,
`idempotency_key` (único por tenant+código), `correlation_id`, `causation_id`. Sin identidad global del evento, sin
productor, sin versión de agregado ni de esquema, sin recibos por consumidor: «procesado» significaba «el orquestador
de notificaciones lo procesó» (H09 del plan).

## Qué se añade (todo nullable o con default; ninguna columna anterior cambia)

| Columna | Tipo | Para qué |
|---|---|---|
| `event_id` | `UUID NOT NULL DEFAULT gen_random_uuid()`, único | Identidad global: la que viaja al transporte y la que el inbox recuerda. Las filas anteriores la reciben al vuelo. |
| `producer` | `VARCHAR(80)` | Módulo/contexto que escribió el evento. Nulo en filas legacy. |
| `aggregate_version` | `BIGINT` | Orden por agregado (no global). Nulo en legacy. |
| `schema_version` | `INTEGER NOT NULL DEFAULT 1` | Versión del payload; un consumidor rechaza o cuarentena lo que no entiende (AT-032). |
| `owner_token` | `VARCHAR(64)` | Testigo de lease del relay (mismo mecanismo que idempotencia, AT-009/AT-034). |

Tabla nueva `platform_ops.inbox_receipts (consumer_id, event_id, producer, status, attempts, last_error, processed_at)`
con **unicidad `(consumer_id, event_id)`**: el mismo consumidor no procesa dos veces el mismo evento; otro consumidor sí lo
recibe (probado con dos consumidores).

## Compatibilidad

- Una fila escrita por un productor viejo (sin sobre) queda `pending`, con `event_id` generado y `schema_version = 1`:
  el relay actual la procesa igual (probado).
- `down` retira las columnas y la tabla de recibos. Los recibos se pierden: por eso el procesamiento de consumidores
  tiene que ser idempotente por diseño (AT-035), no por confiar en el inbox.
- Ningún índice anterior cambia; `ux_outbox_tenant_event_idempotency_key` sigue protegiendo la creación por clave.

## Camino a bases separadas

Mientras se comparte base, `platform_ops.outbox_events` es el outbox de **todos** los productores (hoy lo escriben cuatro
módulos) y `inbox_receipts` el inbox de todos los consumidores; los roles de contexto tienen DML sobre ambas
(`db-role-matrix.md`). Al separar la base de Mensajería (F9): su outbox y su inbox se crean en su base con este mismo
esquema; los eventos pendientes se copian por rango con checkpoint y se reconcilian por `event_id` (AT-058). Un outbox
central remoto **no** se hace: volvería a introducir la escritura dual.
