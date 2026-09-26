# Paridad de decisiones al separar política de persistencia (AT-016)

**Regla:** mover una política fuera de un servicio no cambia ninguna decisión. Mismos hechos, mismo reloj, misma
versión de regla → misma salida (elegible, bloqueadores, secciones, porcentaje). Lo mide
`test/unit/domain/decision-parity.spec.ts` con `test/unit/domain/fixtures/eligibility-parity.json`.

## Lo que ya era puro y se reutiliza

| Política | Función pura | Dónde la consume el servicio |
|---|---|---|
| Elegibilidad del cliente | `assess(facts, status, now)` en `customer-eligibility.evaluator.ts` | `CustomerEligibilityService.evaluate` / `evaluateAndRecord` |
| Elegibilidad por producto | `evaluateProductEligibility(product, body, values)` | `CreditApplicationAdmissionService.admitApplication` |
| Puntuación heurística de riesgo | `computeHeuristicScores(...)`, `buildHeuristicFallback`, `toPolicyFeatures` en `risk/application/` | `RiskService.createRiskAssessment` |
| Reglas de riesgo versionadas | `risk-ruleset-evaluator.ts`, `risk-rule-expression.ts` | `RiskPolicyDecisionService` |

No se duplicó ningún motor: la separación consistió en **inyectar el reloj** (`CLOCK`, `src/platform/di/clock.ts`) en
`CustomerEligibilityService` y `RiskService`, que llamaban a `new Date()` en el punto de decisión. Con
`fixedClock('2026-09-01')` el mismo documento que hoy está vencido estaba vigente, y la prueba lo demuestra.

## Fixtures de frontera (generadas con la regla vigente el 2026-09-11)

| Caso | Resultado registrado |
|---|---|
| Documento que vence **hoy** | elegible (vigente hasta 23:59:59.999 del día) |
| Documento que venció **ayer** | `IDENTITY_DOCUMENT_EXPIRED` |
| Riesgo decidido hace exactamente `RISK_ASSESSMENT_TTL_DAYS` | elegible |
| Un día más | `RISK_ASSESSMENT_STALE` |
| Cumple 18 años hoy | elegible |
| Nacido en 2010 | `PROFILE_INCOMPLETE` (birthDate) |
| Empleado sin antigüedad | `FINANCIAL_PROFILE_INCOMPLETE`; independiente sin antigüedad: elegible |
| Cuenta `under_review` con todo lo demás en regla | `ACCOUNT_NOT_ACTIVE` (la promoción automática es del servicio, no de la regla) |
| Cerrado y sin nada | 10 bloqueadores, en el orden de la regla |

Un cambio **intencional** de regla regenera las fixtures en su propia tarea, con el cambio de decisión en el reporte;
esta prueba no se «arregla» regenerando.

## Sin fallback nuevo

`latestRisk: null` → `RISK_NOT_APPROVED`; `identityVerificationResult: null` → `IDENTITY_NOT_VERIFIED`. Una feature
ausente sigue siendo rechazo, no aprobación por defecto. La prueba lo fija para que un refactor no lo suavice.
