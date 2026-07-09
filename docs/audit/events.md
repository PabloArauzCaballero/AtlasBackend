# Auditoría — Módulo `events`

**Alcance revisado:** `events.controller.ts`, `.service.ts`, `.repository.ts`, `.schemas.ts`,
`.module.ts`, `event-registry.ts`, `event-types.ts`. Tests:
`test/unit/events/events.service.spec.ts`.

**Resultado:** sin hallazgos críticos/altos/medios. No se modificó código.

---

## Por qué no hay hallazgos que corregir

- El controller completo (`operations/events`) está correctamente detrás de
  `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)` con roles internos — a diferencia de
  `internal-portal` (auditoría #18, mismo lote), este módulo sí tiene el guard de roles aplicado.
- `getById`/todas las queries de listado están scoped por `tenantId` (`repository.getById(tenantId,
  eventId)`) — no es posible leer/reintentar/cancelar un evento de otro tenant conociendo su id.
- `publish` valida que el `eventCode` esté registrado (`getEventDefinition`) y que el
  `aggregateType` enviado esté en la lista permitida para ese evento
  (`EVENT_AGGREGATE_NOT_ALLOWED`) antes de escribir — no se puede publicar un evento arbitrario
  con un tipo de agregado incoherente.
- La idempotencia de `createEvent` no es solo un chequeo de presencia de header: busca un evento
  existente por `(tenantId, eventCode, idempotencyKey)` antes de crear uno nuevo y, si existe,
  devuelve el mismo — respaldado además por el índice único real
  `ux_outbox_tenant_event_idempotency_key` a nivel de base de datos (migración
  `20260630183000-patch-2-event-messaging-core.ts`).
- `retryEvent`/`cancelEvent` rechazan explícitamente operar sobre un evento ya `processed`
  (`PROCESSED_EVENT_CANNOT_BE_RETRIED`/`_CANCELLED`) — no se puede reintentar o cancelar un
  evento que ya se procesó con éxito.
- `payload`/`metadata` pasan por `redactSensitiveObject` antes de persistirse en
  `eventPayloadJson`/`metadataJson`.
- `processPendingEvents` (el worker de procesamiento) usa `claimPending` con lock
  (`lockedAt`/`lockedBy`) para reclamar eventos, y aplica backoff exponencial acotado
  (`addBackoff`, máximo 60 min) en reintentos fallidos, marcando `failed` solo al agotar
  `maxAttempts` — no hay reintento infinito ni pérdida silenciosa de eventos fallidos.
