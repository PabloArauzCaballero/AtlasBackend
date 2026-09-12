# ADR — Consistencia de hechos en la admisión de crédito (AT-007)

**Estado:** aprobado en implementación, 2026-09-11. **Alcance:** `CreditApplicationAdmissionService.persistApplication`
y `CustomerEligibilityService.evaluateAndRecord`. **Pruebas:** `test/integration/credit/admission-consistency.spec.ts`,
`application-evaluation-identity.spec.ts`, `denied-attempt-evidence.spec.ts` (PostgreSQL real, `yarn test:integration`).

## Invariante

Una solicitud de crédito se admite sobre **un único conjunto de hechos del cliente, leído dentro de la transacción que
escribe la evaluación y la solicitud**, y queda enlazada a **la fila exacta** de evaluación que la autorizó. Ninguna decisión
concurrente sobre el mismo cliente se cruza con la admisión: se ordena antes o después.

## Qué había (dev@5650b95, antes de AT-006/007/008)

| Lectura en la admisión | Transacción | Consecuencia |
|---|---|---|
| `loadFacts` para la elegibilidad por producto | **No** | Podía ver un estado distinto del que veía la evaluación general un instante después. |
| `loadFacts` dentro de `evaluateAndRecord` | Sí | — |
| `getLatestEvaluation` para enlazar `eligibility_evaluation_id` | **No** | Sin CLS (`database.config.ts` no declara `namespace`), otra conexión no ve la fila recién insertada: enlazaba la evaluación **anterior** o `null`. Reproducido: `Expected "29", Received "28"` / `undefined`. |
| Denegación por inelegibilidad | `throw` dentro del callback | Rollback: la evidencia que el comentario daba por escrita desaparecía. Reproducido: `Expected 1, Received 0` evaluaciones. |

## Decisión

1. **Bloqueo de fila del cliente** al entrar en la admisión: `CustomerEligibilityService.lockCustomerForDecision`
   (`SELECT … FOR UPDATE` sobre `customer.customers`, el mismo bloqueo que toma `CustomerLifecycleService.transition`).
   Efecto medido: dos admisiones concurrentes producen una solicitud y un `CREDIT_APPLICATION_ALREADY_OPEN`; un bloqueo de
   cuenta concurrente **espera** a la admisión en curso y se aplica después (`previous_status = 'active'`), o llega antes y la
   admisión deniega con `ACCOUNT_NOT_ACTIVE`. No hay tercera opción.
2. **Un solo `loadFacts`**, con la transacción, reutilizado por la elegibilidad por producto y por
   `evaluateAndRecord({ facts })`. La evaluación general y la del producto ya no pueden ver dos estados.
3. **`evaluateAndRecord` devuelve `evaluationId`** (`RecordedEligibility`); la solicitud enlaza ese id y su snapshot.
   `getLatestEvaluation` queda para lectura histórica. El contrato HTTP de elegibilidad no cambia: `toEligibilityResponse`
   retira `evaluationId` antes de responder.
4. **La denegación es un resultado, no una excepción** (`AdmissionOutcome`): el callback devuelve `{ admitted: false }`,
   la transacción confirma la evidencia y `UnprocessableEntityException('CUSTOMER_NOT_ELIGIBLE: …')` se lanza **fuera**
   del callback con el mismo mensaje de siempre. Los fallos técnicos siguen provocando rollback completo.

## Qué cubre el bloqueo y qué no

| Hecho que puede cambiar durante la admisión | ¿Toma el bloqueo del cliente? | Estado |
|---|---|---|
| Estado de ciclo de vida (`blocked`, `closed`, `suspended`…) | **Sí** (`transition` → `findForUpdate`) | Ordenado y probado. |
| Caché de elegibilidad del cliente (`credit_eligibility_status`) | Sí (misma fila) | Ordenado. |
| Consentimientos (`privacy.customer_consents`) | **No** | Residual: una revocación que confirme entre el `loadFacts` y el `commit` no se ve. AT-028 debe hacer que el comando de revocación tome el bloqueo del cliente o publique una revisión. |
| Casos de fraude, coincidencias de listas (`case_management`) | **No** | Residual, mismo tratamiento en AT-029. |
| Resultado de riesgo (`risk.risk_assessment_results`) | **No** | Residual; AT-027. Un resultado nuevo entre lectura y commit no invalida la admisión ya escrita: la política de negocio debe decir si eso es aceptable (hoy la solicitud pasa después por el motor de decisión, que reevalúa). |
| Producto de crédito (`credit.credit_products`) | No | Se lee con la transacción; un cambio concurrente del producto es un caso administrativo, no del cliente. |

Se eligió bloqueo de fila y no `SERIALIZABLE` con reintentos porque: (a) el bloqueo ya existía en las transiciones de
ciclo de vida, así que la admisión se suma a una convención en vez de inventar otra; (b) el aislamiento serializable habría
obligado a reintentar todas las rutas que hoy escriben sobre el cliente, y varias no son idempotentes en su efecto
externo (envío de OTP, cobro a proveedor). El límite de reintentos que pide el plan queda por tanto en cero: no hay bucle
posible, sólo espera de bloqueo acotada por `DB_STATEMENT_TIMEOUT_MS` / `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`.

## Cambio de comportamiento observable (declarado)

Tras AT-008, **una denegación deja una fila en `customer.customer_eligibility_evaluations`** con
`reason_code = 'credit_application_requested'` y `eligible = false`; antes no dejaba nada. Es la política que el propio
código describía («deja rastro sin crear ruido») y que el rollback impedía cumplir. Códigos, mensajes y formato de error
HTTP no cambian.
