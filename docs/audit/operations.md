# Auditoría — Módulo `operations`

**Alcance revisado:** `operations.controller.ts`, `.service.ts`, `.repository.ts`,
`.mapper.ts`, `.dtos.ts`, `.schemas.ts`, `.module.ts`. Por el acoplamiento explícito con
`fraud` (`decideFraudCase` vive en `FraudService` pero la ruta HTTP sigue en este controller;
`createStatusEvent`/`createCustomerObservation` están deliberadamente duplicados en
`fraud.repository.ts`), también se revisaron los puntos de contacto
correspondientes en `fraud.service.ts`/`fraud.repository.ts` (sin reabrir el resto del módulo
`fraud`, ya auditado en el módulo #7). Tests: `test/unit/operations/operations.service.spec.ts`,
`test/unit/fraud/fraud.service.spec.ts` (solo la parte tocada).

**Resultado:** 1 hallazgo Medio (trazabilidad de auditoría, presente en dos copias
duplicadas del mismo método), corregido en ambas. Suite verde tras el cambio (20/20 en
`operations`, 8/8 en `fraud`).

---

## Hallazgo (Medio) — `createStatusEvent` no registraba el actor interno, a diferencia de las otras 3 escrituras de auditoría del mismo flujo

**Dónde:** `operations.repository.ts::createStatusEvent` (invocado desde
`decideManualReviewCase`) y su copia deliberada `fraud.repository.ts::createStatusEvent`
(invocado desde `FraudService.decideFraudCase`).

**Qué encontré:** dentro del mismo método `decideManualReviewCase`/`decideFraudCase`, hay 4
escrituras de auditoría/trazabilidad por decisión: `createManualReviewEvent`/`createWatchlistEntry`,
`createStatusEvent`, `createOperationalAudit`, `createDataChange`. Las 3 últimas (menos
`createStatusEvent`) ya pasaban `actorInternalUserId: input.currentUser.internalUserId ?? null`
correctamente — el proyecto ya tiene el patrón correcto aplicado en general en este módulo (a
diferencia de `customer-privacy`/`customer-telemetry`, auditorías #10 y #11 de este mismo lote,
donde el patrón faltaba sistemáticamente). Solo `createStatusEvent` quedó afuera: ni el
repositorio aceptaba el campo, ni el service lo pasaba, pese a que
`customer_status_events.changed_by_internal_user_id` existe en el schema exactamente para esto
(confirmado en `customer-privacy.md`, mismo lote).

**Por qué importa:** es menor que los hallazgos Alto anteriores porque el resto de la cadena de
auditoría del mismo evento (`createOperationalAudit`, `createDataChange`) sí queda con el actor
real — no se pierde la trazabilidad de "quién decidió el caso", solo la de "quién causó
específicamente este cambio de estado del cliente" si alguien solo mira `customer_status_events`
de forma aislada (p. ej. para entender el historial de un cliente sin cruzar con
`operational_audit_logs`).

**Corrección aplicada:** ambas copias (`operations.repository.ts` y `fraud.repository.ts`)
ahora aceptan `actorInternalUserId` en `createStatusEvent` y lo escriben en
`changedByInternalUserId`; ambos service callers (`OperationsService.decideManualReviewCase`,
`FraudService.decideFraudCase`) pasan `input.currentUser.internalUserId ?? null`. Test añadido
en `operations.service.spec.ts` que verifica el campo en la llamada a `createStatusEvent`.

---

## Qué quedó verificado como correcto (sin cambios)

- Los 4 endpoints de listado/detalle (`work-queue`, `manual-review-cases`,
  `fraud-cases`, `investigation-summary`) están restringidos a roles internos vía `@Roles(...)`
  a nivel de controller (o sobreescrito más estrictamente a nivel de método, como
  `fraud-cases` que añade `fraud_analyst`); no hay ningún acceso de cliente a este módulo.
- `findManualReviewCaseById`/todas las queries de cola están scoped por `tenantId` — no es
  posible operar sobre un caso de otro tenant adivinando un `caseId`.
- `decideManualReviewCase` exige `X-Idempotency-Key`, valida `CASE_NOT_FOUND` y
  `CASE_ALREADY_CLOSED` antes de escribir nada, y exige `notes` cuando la decisión es
  `rejected`/`request_more_information` (`DECISION_REASON_REQUIRED`).
- El `createStatusEvent`/`createCustomerObservation` de este flujo solo se disparan cuando el
  caso tiene `customerId` **y** el body trae `nextCustomerStatus` — confirmado con 3 tests
  dedicados a las combinaciones (ninguno, solo uno, ambos presentes).
- `toInvestigationSummaryResponse` expone el desglose de riesgo (`fraudScore` incluido) sin
  reducir campos — a diferencia del hallazgo de código muerto en `risk.md` (auditoría #6) donde
  se advirtió sobre no exponer ese desglose a `customer`, aquí es intencional y seguro porque el
  endpoint está exclusivamente detrás de roles internos de investigación.
- Toda la escritura de `decideManualReviewCase`/`decideFraudCase` ocurre dentro de una única
  transacción Sequelize.
