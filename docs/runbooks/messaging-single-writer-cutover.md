# Runbook · corte de escritor único de Mensajería (AT-059)

Ensayo automatizado: `test/integration/messaging/single-writer-cutover.spec.ts`. Registro: `platform_ops.context_ownership`.
**Este runbook es para staging. La autorización de producción se registra aparte y no la da este documento.**

## Estado

```sql
SELECT context, owner, epoch, changed_by, changed_at FROM platform_ops.context_ownership WHERE context = 'messaging';
SELECT count(*) FROM platform_ops.outbox_events WHERE status = 'processing' AND aggregate_type <> 'api_command'; -- en vuelo
SELECT count(*) FROM platform_ops.outbox_events WHERE status = 'pending' AND aggregate_type <> 'api_command';    -- pendientes
```

## Procedimiento

1. **Precondiciones:** `EVENTS_RELAY_V2_ENABLED=true` en el monolito (el relay v1 no consulta la propiedad); el worker del
   piloto arrancado con `MESSAGING_DB_USER=atlas_ctx_messaging` y latiendo cercado (`fenced: true` en su log).
2. **Pausa de nuevas escrituras:** no hace falta parar la API: los productores siguen escribiendo en el outbox; lo que se
   transfiere es quién lo drena.
3. **Drenado:** esperar a que «en vuelo» sea 0 (un lote del relay dura segundos). Si no baja, hay un relay muerto: el
   reaper `reclaim_stuck_events` lo devuelve a pending (5 min) o se transfiere con `requeueInFlight` (reentrega, el inbox
   deduplica).
4. **Transferencia** (una sola vez, con la época que se acaba de leer):
   `ContextOwnershipRegistry.transfer({ context: 'messaging', from: 'monolith', to: 'messaging-worker', expectedEpoch: <época>, changedBy: '<quién>' })`.
   Si otra persona ya transfirió, falla con `OWNERSHIP_FENCED` y no hace nada.
5. **Comprobación:** el log del monolito muestra `OWNERSHIP_FENCED messaging`; el worker deja de estar `fenced` y
   `published` crece; «pendientes» baja. Los eventos de antes del corte los entrega el nuevo dueño.
6. **Canary por tenant:** no existe todavía (la propiedad es por contexto, no por partición). Un corte parcial por tenant es
   trabajo futuro y se anota en `remaining-exceptions.md`.

## Reversión

Es otra transferencia (`from: 'messaging-worker', to: 'monolith'`) con la época vigente: AT-060
(`docs/runbooks/messaging-rollback-after-writes.md`). Cambiar DNS o apagar el worker NO revierte la propiedad.
