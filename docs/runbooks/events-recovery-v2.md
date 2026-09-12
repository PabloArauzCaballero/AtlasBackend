# Recuperación de eventos (relay v2, inbox y DLQ)

Se usa cuando: hay eventos `failed` en `platform_ops.outbox_events`, un consumidor está atascado, o hay que reprocesar
un evento ya entregado. Piezas: `OutboxRelayService` (`src/platform/events/outbox-relay.service.ts`), inbox
`platform_ops.inbox_receipts`, política `retry-policy.ts`.

## 1. Diagnóstico (sólo lectura)

```sql
-- Retraso del outbox de dominio
SELECT status, count(*), min(available_at) FROM platform_ops.outbox_events
 WHERE aggregate_type <> 'api_command' GROUP BY status;
-- DLQ: permanentes (cuarentena) vs agotados
SELECT error_code, count(*) FROM platform_ops.outbox_events WHERE status = 'failed' GROUP BY error_code;
-- Quién está atascado: recibos fallidos por consumidor
SELECT consumer_id, status, count(*) FROM platform_ops.inbox_receipts GROUP BY 1, 2;
-- Leases vencidos (relay muerto a medias)
SELECT _id, event_id, locked_by, locked_at FROM platform_ops.outbox_events
 WHERE status = 'processing' AND locked_at < now() - interval '5 minutes';
```

## 2. Lease vencido

Un relay murió con eventos `processing`. **No** cambies el estado a mano: el job `reclaim_stuck_events`
(`POST /api/v1/runtime-jobs/reclaim-stuck-events`, o el reclaim del planificador) los devuelve a `pending` o `failed`
según intentos. El testigo `owner_token` hace que, si el relay viejo despierta, su cierre no escriba
(`OUTBOX_LEASE_LOST` en el log): es esperado, no un error.

## 3. `EVENT_QUARANTINED` (permanente)

Causas: versión de esquema que ningún consumidor entiende, ámbito inválido, clave prohibida en el payload. No se
reintenta solo. Pasos: (a) leer `last_error`; (b) si es un consumidor sin la versión nueva → desplegar el consumidor y
hacer replay (§5); (c) si es payload prohibido → el productor tiene un bug: corregirlo; el evento **no** se edita
(payload inmutable): se genera uno nuevo desde el agregado si el hecho sigue vigente.

## 4. `EVENT_MAX_ATTEMPTS` (agotado)

Fallo transitorio repetido (proveedor caído, DB del consumidor). Verificar que la causa terminó y hacer replay (§5).
Si el consumidor tiene efecto externo (SMS, cobro), **antes** consultar en el proveedor si el efecto ocurrió: el inbox
evita repetir el efecto local, no el externo.

## 5. Replay administrativo

Exige permiso `events.dead_letter.replay` y **mismo tenant** que el evento (`authorizeReplay`); se audita en
`operational_audit_logs`. Es el retry existente (`POST /api/v1/events/:id/retry`) que devuelve la fila a `pending`
conservando `event_id`: los consumidores que ya lo procesaron lo reconocen por su recibo y no repiten; los que no,
lo procesan por primera vez. Nunca insertar una copia del evento (rompe la identidad).

## 6. Hueco de versiones (`ORDER_GAP`)

Un consumidor recibió la versión N+2 antes que N+1 del mismo agregado: espera (`retry` con backoff), no aplica. Si el
hueco persiste más de una hora, falta un evento: buscarlo por `aggregate_type, aggregate_id, aggregate_version` en el
outbox; si está `failed`, resolver ese primero.

## 7. Verificación

Repetir §1: `pending` decrece, `failed` sólo con causa conocida, sin `processing` viejos. Métrica `outbox backlog`
en `/metrics`.
