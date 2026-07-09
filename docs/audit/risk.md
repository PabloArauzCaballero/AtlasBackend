# Auditoría — Módulo `risk`

**Alcance revisado:** `risk.controller.ts`, `.service.ts`, `.repository.ts`, `.mapper.ts`,
`.schemas.ts`, `.dtos.ts`, `.module.ts`. Tests: `test/unit/risk/risk.service.spec.ts`,
`test/unit/risk/risk.controller.spec.ts`.

**Resultado:** sin hallazgos de seguridad. 1 observación de estructura/deuda técnica
documentada, **no corregida** (requiere una decisión de producto, ver justificación
abajo). No se modificó código en este módulo. Suite verde sin cambios (16/16).

---

## Observación — `RiskService.getLatestCustomerRiskResult` es código muerto (nunca expuesto por ningún endpoint)

**Dónde:** `risk.service.ts`, método `getLatestCustomerRiskResult`.

**Qué encontré:** el método existe, está completo (`assertOwnCustomerResource` +
`NotFoundException` + retorno `null` cuando no hay evaluación previa) y tiene 3 tests
unitarios dedicados en `risk.service.spec.ts`. Pero **ningún controller lo invoca** —
`RiskController` solo expone `createRiskAssessment`, `getRiskAssessmentDetail` y
`getRiskAssessmentExplanation`. No hay ninguna ruta HTTP tipo `GET
/customers/:customerId/risk` que llegue a este método.

En su lugar, el dato de riesgo que sí llega al cliente hoy viene de un camino
completamente distinto: `CustomersService.getCustomerMe` (módulo `customers`, ya
auditado) llama directamente a `CustomersRepository.findLatestRiskResult` — una versión
mucho más reducida (`latestDecision`, `latestRiskLevel`, nada de scores) — sin pasar por
`RiskService` ni por `assertOwnCustomerResource` de este módulo (aunque sí por el mismo
util de ownership, indirectamente, a través del guard de roles + ownership de
`CustomersController`).

**Por qué no lo corregí yo mismo:** hay dos salidas razonables y son decisiones de
producto, no bugs:
1. **Eliminarlo** — es código muerto y su rol quedó cubierto por `customers.mapper.ts`.
2. **Exponerlo** como endpoint real (p. ej. `GET /customers/:customerId/risk`) si el
   equipo sí quiere que el cliente consulte su historial de riesgo con más detalle que lo
   que devuelve `/me`.

Ninguna de las dos es una corrección de bug — son una decisión de alcance de API que no
me corresponde tomar unilateralmente en una auditoría.

**Riesgo si se elige la opción 2 sin cuidado:** `toRiskAssessmentResultResponse`
(`risk.mapper.ts`) devuelve el desglose **completo** del modelo de riesgo interno:
`fraudScore`, `identityScore`, `deviceRiskScore`, `behaviorScore`, `contactabilityScore`,
`consistencyScore`, `reasonCodes`, y las versiones de modelo/ruleset usadas. Si alguien
en el futuro decide simplemente "conectar" este método ya-existente-y-ya-autorizado-para-
`customer` a un endpoint nuevo sin revisar qué campos expone, el cliente evaluado vería
el detalle exacto de su propio scoring de fraude — información que normalmente se protege
precisamente para que un actor de riesgo no pueda usarla para ajustar su comportamiento y
evadir el modelo ("model gaming"). Si se decide exponerlo, debería pasar por un mapper
distinto y más reducido (similar al de `customers.mapper.ts`), no reutilizar
`toRiskAssessmentResultResponse` tal cual.

**Recomendación:** decidir explícitamly (a) eliminar el método y sus tests, o (b)
diseñar un endpoint público con un DTO de salida deliberadamente acotado. Cualquiera de
las dos cierra la ambigüedad; dejarlo como está hoy (código correcto, probado, pero
inalcanzable) es la única opción que no aporta valor.

---

## Addendum (durante la auditoría #14, `audit`) — `createAudit` sin actor interno

Al construir las ramas nuevas de `AuditRepository.findCustomerAuditEvents` (ver
[audit.md](./audit.md)) se confirmó el mismo patrón ya corregido en `customer-privacy`,
`customer-telemetry`, `operations` y `fraud`: `RiskRepository.createAudit` escribía
`actorInternalUserId: null` fijo pese a que `createRiskAssessment` es accesible también por
`internal_operator`/`risk_analyst`/`admin`/`platform_admin` (no solo `customer`). Se corrigió
aquí también — `risk.service.ts` ahora pasa `input.currentUser.internalUserId ?? null`.

---

## Qué quedó verificado como correcto (sin cambios)

- `createRiskAssessment` exige `X-Idempotency-Key`, verifica ownership
  (`assertOwnCustomerResource`), bloquea clientes con `lifecycleStatus: 'blocked'`, y
  exige al menos un consentimiento vigente otorgado (`REQUIRED_CONSENT_MISSING`) antes de
  generar cualquier evaluación.
- Todas las queries de `risk.repository.ts` (incluidas las de operaciones,
  `findRiskRun`/`findRiskResultByRun`/etc.) están escopadas por `tenantId` — no hay forma
  de leer una evaluación de riesgo de otro tenant conociendo un `runId`.
- Los endpoints de operaciones (`getRiskAssessmentDetail`,
  `getRiskAssessmentExplanation`) excluyen explícitamente el rol `customer` en
  `@Roles(...)` — correcto, dado que devuelven el desglose completo del modelo.
- Cuando la decisión es `manual_review_required`, se crea automáticamente el caso de
  revisión manual (`createManualReviewCase`) y las incidencias de calidad de datos
  correspondientes (`createDataQualityIssue`) por cada campo faltante — la cadena
  downstream (operations/data-quality) queda alimentada sin pasos manuales adicionales.
- Toda la escritura ocurre dentro de una única transacción Sequelize.
