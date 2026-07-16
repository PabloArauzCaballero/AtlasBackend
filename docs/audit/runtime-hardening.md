# Auditoría — Módulo `runtime-hardening`

**Alcance revisado:** `runtime-hardening.service.ts`, `idempotency.interceptor.ts`,
`outbox.interceptor.ts`, `.module.ts`. Ambos interceptores están registrados como
`APP_INTERCEPTOR` global en `app.module.ts` — se verificó su orden de registro
(`HttpActionLogInterceptor` → `IdempotencyInterceptor` → `ApiCommandOutboxInterceptor` →
`ResponseInterceptor`) y su efecto combinado sobre **todo** endpoint `POST/PUT/PATCH/DELETE` del
proyecto, no solo los de este módulo. Tests: `test/unit/runtime-hardening/runtime-hardening.service.spec.ts`.

**Resultado:** 1 hallazgo Medio (carrera en `claimIdempotency` bajo la misma
`idempotencyKey` concurrente), corregido. Suite verde tras el cambio (14/14, incluye 1 test
nuevo).

---

## Hallazgo (Medio) — carrera en `claimIdempotency` podía propagar un 500 en vez de resolver la idempotencia

**Dónde:** `runtime-hardening.service.ts::claimIdempotency` — usado por `IdempotencyInterceptor`,
que es `APP_INTERCEPTOR` global y por tanto está en el camino de **todo** endpoint de escritura
del proyecto que envíe `X-Idempotency-Key`.

**Qué encontré:** el método hacía `findOne` y, si no encontraba nada, `create` — un patrón
"check-then-act" clásico. Si dos requests con la **misma** `idempotencyKey` (mismo
`tenantScope`/`scope`) llegaban lo bastante cerca en el tiempo, ambas podían pasar el `findOne`
sin ver nada (ninguna había comiteado todavía), y ambas intentaban `create`. El índice único real
(`ux_idempotency_scope_key` sobre `(tenant_scope, scope, idempotency_key)`, confirmado en la
migración `20260629170000-add-runtime-hardening-tables.ts`) rechaza correctamente el segundo
insert a nivel de base de datos — pero el código no capturaba ese `UniqueConstraintError`, así
que se propagaba como una excepción no manejada (500 genérico) en vez de resolverse como
"la otra request ya está encargándose de esto" (`IDEMPOTENCY_REQUEST_IN_PROGRESS` /
`IDEMPOTENCY_CONFLICT` / replay, según corresponda).

**Por qué importa:** es infraestructura compartida por todo el proyecto, exactamente en el punto
que existe para dar una garantía fuerte ("un reintento con la misma clave nunca duplica ni
sorprende al cliente"). Bajo el escenario más común que dispara esta carrera — un cliente que
reintenta una petición porque el primer intento pareció colgarse, dos tabs/dispositivos del mismo
usuario, o un doble-tap en la UI — el resultado observable pasaba a ser un 500 sin relación
aparente con el problema real, en vez del comportamiento de idempotencia documentado.

**Corrección aplicada:** el `create` ahora está en un `try/catch`; si falla con
`UniqueConstraintError`, se vuelve a leer el registro (que la otra request ganadora ya
insertó) y se procesa con la misma lógica que ya existía para "encontrado en el `findOne`
inicial" (extraída a `claimExisting`, reutilizada en ambos caminos) — respeta `requestHash`
distinto (`IDEMPOTENCY_CONFLICT`), lock activo (`IDEMPOTENCY_REQUEST_IN_PROGRESS`), o replay si ya
completó. Test nuevo simula la carrera (`findOne` inicial nulo, `create` rechazado con
`UniqueConstraintError`, segundo `findOne` sí encuentra el registro ganador) y confirma que
resuelve como conflicto/en-progreso en vez de propagar el error de base de datos.

---

## Qué quedó verificado como correcto (sin cambios)

- `IdempotencyInterceptor` espera realmente la persistencia (`completeIdempotency`/
  `failIdempotency`) antes de responder; antes
  era fire-and-forget (`void this.runtime.completeIdempotency(...)`) y que eso podía dejar al
  cliente con una respuesta `OK` sin que la idempotencia hubiera quedado registrada; ya está
  corregido.
- `ApiCommandOutboxInterceptor` también espera la
  escritura del evento de outbox antes de devolver la respuesta.
- El hash de idempotencia (`requestHash`) se calcula sobre `body` **redactado**
  (`redactSensitiveObject`) + `query` + `params` — no se guarda el payload crudo con datos
  sensibles como parte de la clave de comparación, y `completeIdempotency` redacta también el
  `responseBodyJson` antes de persistirlo.
- `listPendingOutbox` ordena por `(availableAt, id)` de forma determinística y filtra por
  `availableAt <= now()` — consistente con el patrón de reintento con backoff visto en
  `events.repository.ts`/`runtime-jobs.service.ts` (mismo lote de auditoría).
