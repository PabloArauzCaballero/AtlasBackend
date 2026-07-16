# Auditoría — Módulo `customer-privacy`

**Alcance revisado:** `customer-privacy.controller.ts`, `.service.ts`, `.repository.ts`,
`.schemas.ts`, `.module.ts`; modelos `CustomerConsentModel`, `ConsentEventModel`,
`CustomerStatusEventModel`, `CustomerActionLogModel`, `DataSubjectRequestModel`,
`OperationalAuditLogModel`; `ownership.util.ts` (compartido); `IdempotencyInterceptor`
(`runtime-hardening`, verificado como `APP_INTERCEPTOR` global en `app.module.ts:89` — cubre
ambos endpoints de este módulo, no solo el chequeo de presencia del header). Tests:
`test/unit/customer-privacy/customer-privacy.service.spec.ts`.

**Resultado:** 1 hallazgo Alto (trazabilidad de auditoría), corregido. Suite
verde tras el cambio (12/12, incluye 1 test nuevo).

---

## Hallazgo (Alto) — se pierde el actor interno real en el rastro de auditoría de acciones de privacidad

**Dónde:** `customer-privacy.repository.ts`, métodos `createConsentEvent`, `createStatusEvent`,
`createAudit`; invocados desde `customer-privacy.service.ts` en
`registerConsentDecisions`/`createDataSubjectRequest`.

**Qué encontré:** las tres tablas involucradas (`consent_events.triggered_by_internal_user_id`,
`customer_status_events.changed_by_internal_user_id` / `changed_by_platform_user_id`,
`operational_audit_logs.actor_internal_user_id` / `actor_platform_user_id`) tienen columnas
dedicadas exactamente para esto — y el `AuthenticatedUser` que llega al service ya trae
`internalUserId`/`platformUserId` (`auth.types.ts`). Pero el repositorio los escribía como
`null` fijo en las tres escrituras, guardando solo `actorType` (el **rol**, p. ej.
`compliance_analyst`), nunca la identidad de la persona concreta.

**Por qué importa:** `registerConsentDecisions` y `createDataSubjectRequest` están expuestos no
solo a `customer` sino también a `internal_operator`, `compliance_analyst`, `admin` y
`platform_admin` — roles que pueden actuar en nombre de cualquier cliente (por diseño, vía
`assertOwnCustomerResource`, que solo restringe al rol `customer`). Son las dos superficies más
sensibles legalmente del sistema (decisiones de consentimiento y solicitudes ARCO/GDPR). Con el
bug, si dos personas distintas con rol `compliance_analyst` tocan el mismo registro, el audit
log es indistinguible entre ellas — solo dice "un compliance_analyst hizo esto", no cuál. Ante
una disputa regulatoria o una investigación interna de mal uso, esa columna vacía es
exactamente el dato que haría falta reconstruir y no se puede recuperar retroactivamente.

**Corrección aplicada:**
- `customer-privacy.repository.ts`: `createConsentEvent` ahora acepta `actorInternalUserId` y
  lo escribe en `triggeredByInternalUserId` (antes `null` fijo). `createStatusEvent` ahora
  acepta `actorInternalUserId`/`actorPlatformUserId` y los escribe en
  `changedByInternalUserId`/`changedByPlatformUserId` (antes ausentes del payload, columnas
  nunca pobladas). `createAudit` ahora recibe y escribe ambos campos en vez de `null` fijo.
- `customer-privacy.service.ts`: las 4 llamadas correspondientes (2 en
  `registerConsentDecisions`, 1 en `createDataSubjectRequest` vía `createAudit`) ahora pasan
  `input.currentUser.internalUserId ?? null` / `input.currentUser.platformUserId ?? null`. Para
  un actor `customer`, esto sigue siendo `null` de forma natural (esos campos no existen en su
  token) — el comportamiento solo cambia para actores internos.
- Test nuevo en `customer-privacy.service.spec.ts`: verifica que un `compliance_analyst` con
  `internalUserId: 'iu-42'` propaga ese id tanto a `createConsentEvent` como a `createAudit`
  (antes del fix, ambos habrían recibido `null`/ausente).

---

## Qué quedó verificado como correcto (sin cambios)

- Ambos endpoints exigen `X-Idempotency-Key` con chequeo explícito en controller y de nuevo en
  el service (defensa en profundidad); la deduplicación real de reintentos la hace
  `IdempotencyInterceptor` de forma global (`app.module.ts:89`), no solo el chequeo de
  presencia — confirmé que cubre `POST` y que estos dos endpoints entran en su alcance
  (`shouldHandle` incluye `POST`).
- `assertOwnCustomerResource` bloquea a un `customer` que intente operar sobre un `customerId`
  distinto al de su propio token; los roles internos listados en `@Roles(...)` pueden actuar
  sobre cualquier cliente del propio tenant, consistente con su propósito de soporte/compliance.
- `registerConsentDecisions` resuelve cada `consentDocumentId` vía
  `consentsRepository.findActiveDocumentById(tenantId, ...)` antes de escribir — no se puede
  registrar una decisión contra un documento de otro tenant o no vigente.
- El batch de decisiones corre dentro de una única transacción; si cualquier documento no es
  válido (`UnprocessableEntityException`), no queda ninguna escritura parcial.
- `currentConsentStatus: 'requires_review'` se dispara con un simple OR sobre todo el batch
  (una sola revocación entre N decisiones basta) — confirmado con test dedicado, comportamiento
  intencional y conservador (favorece revisión de más, no de menos).
- `createDataSubjectRequest` calcula `dueAt` como exactamente 15 días desde `requestedAt` — el
  test existente lo confirma con precisión de milisegundos.
- El emparejamiento `purposeCode` (string libre del cliente) vs. `consentDocumentId` (resuelto
  contra el catálogo real) no se valida cruzado — mismo patrón ya presente y no señalado en
  `customer-onboarding` (módulo #4, ya auditado) y en `consents` (módulo #9, este mismo lote);
  es una decisión de diseño consistente en todo el sistema, no una regresión local de este
  módulo.
