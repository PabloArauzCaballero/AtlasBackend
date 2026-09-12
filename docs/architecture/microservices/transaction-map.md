# Mapa de propiedad de datos y grupos transaccionales (AT-004)

Generado a partir de `docs/architecture/microservices/data-ownership.json` (script
`scripts/architecture/inventory-database.ts` contra `atlas_test`, migraciones al día, 2026-09-11, dev@5650b95) y de
`context-map.json` (AT-063). Lo prueba `test/integration/architecture/database-inventory.spec.ts`. Cifras medidas, no
estimadas; lo que dice «propuesto» es una decisión del plan pendiente de ejecutar.

## Cifras

| Medida | Valor |
|---|---|
| Tablas físicas (fuera de `public` y `read_api`) | 200 |
| Claves foráneas | 403, **205 cruzan schema** |
| Vistas `read_api` | 17 (+1 en otro schema); 2 leen tablas de más de un schema |
| Disparadores / funciones propias | 28 / 4 |
| Tablas registradas (`forFeature`) por más de un módulo | **65** — 48 sin escritor único resoluble por contexto |
| Tablas sin propietario candidato (tras `tableOwners`) | 0 (eran 11: las `schema_*`, `catalog_entries`, `external_oauth_connections`…) |
| Módulos que abren transacciones | customer-onboarding 15 archivos, support 11, credit 5, systems-ops 5, catalog-management 5, loans 4 |

## Los grupos de escritura que el plan nombra

### Alta (onboarding) — puente atómico heredado

`customer-onboarding-start.service.ts` escribe en una transacción con repositorios de **auth** (`auth_credentials`),
**consents** (`customer_consents`), **customers** (`customers`, `customer_contact_methods`) y **sessions**
(`customer_sessions`). Otros catorce servicios del módulo abren transacciones propias sobre `customer.*` y `privacy.*`.
Decisión del plan: se etiqueta **modular, no extraíble**; AT-015 lo encapsula como `LegacyOnboardingAtomicBridge` y prueba
el rollback por etapa. No se convierte en saga.

### Admisión de crédito — límite consistente (cerrado en F1)

`credit-application-admission.service.ts` escribe `customer.customer_eligibility_evaluations` (vía
`CustomerEligibilityService`), `customer.customers` (caché de elegibilidad) y `credit.credit_applications` +
`credit.credit_application_events` en **una** transacción con bloqueo de fila del cliente. Ver `admission-consistency.md`.

**Hallazgo:** `credit.credit_applications` no tiene **ninguna** FK: ni a `customers`, ni a `credit_products`, ni a
`customer_eligibility_evaluations`. Doce tablas de `credit` están igual (`credit_lines`, `loan_events`,
`loan_payment_allocations`, `loan_risk_ratings`…). El enlace `eligibility_evaluation_id` es lógico. AT-021 decide si se
protege con FK (mientras compartan base) o con referencia validada + prueba de huérfanos; hoy no está protegido por nada.

### Riesgo

`risk.service.ts` abre transacción, lee hechos por `CustomersRepository` (importado directamente, H11 del plan) y escribe
`risk.risk_assessment_runs` / `risk_assessment_results` / `feature_*`. `risk` → `telemetry` concentra **15 FKs** cruzadas:
los features apuntan a observaciones y sesiones. AT-027 sustituye la lectura de Clientes por puerto sin tocar el motor.

### Idempotencia y outbox técnico

`platform_ops.idempotency_keys` y `platform_ops.outbox_events`. **Sin** transacción de negocio: el interceptor de outbox
escribe después del handler (H07), y el de idempotencia reclama y cierra en operaciones sueltas. En F1 el reclamo y el
cierre pasaron a actualizaciones condicionales con testigo (`owner_token`, AT-009). `outbox_events` lo registran **4**
módulos (`customers`, `customer-onboarding`, `events`, `runtime-hardening`): escritores múltiples de la misma tabla, que
AT-033/AT-034 reducen a un productor por agregado.

## Dónde se concentran las FKs cruzadas

| Par (origen → destino) | FKs | Lectura |
|---|---|---|
| support → iam | 22 | Casos y asignaciones referencian usuarios internos y tenants. |
| telemetry → iam | 17 | Sesiones y eventos referencian tenant/usuario. |
| risk → telemetry | 15 | Features sobre observaciones y sesiones. |
| customer → iam | 14 | Tenant y usuarios internos que decidieron. |
| case_management → iam | 12 | Casos referencian usuarios internos. |
| telemetry → customer | 12 | Señales del dispositivo referencian al cliente. |

`iam.tenants` e `iam.internal_users` son el destino de la mayoría: antes de separar bases, cada contexto necesita una
referencia lógica a tenant/usuario (identificador estable + validación), no una FK física. Es el trabajo de AT-021, por
contexto, no por tabla.

## Tablas con más de un módulo registrante (las peores)

| Tabla | Módulos que la registran | Escritor declarado |
|---|---|---|
| `operational_audit_logs` | 15 | audit |
| `customer_consents` | 7 | consents |
| `identity_verification_attempts` | 6 | customer-onboarding |
| `data_change_logs` | 6 | audit |
| `customer_status_events` | 6 | customers |
| `customer_observations` | 6 | customers |

El resto (48) queda en `context-map.spec.ts` como deuda acotada: la prueba falla si el número sube sin declarar la tabla en
`tableOwners`.

## SQL fuera del ORM

`support` (10 sentencias), `systems-ops` (8), `expedientes` (5), `internal-users` (3), `decision-engine` (1) componen SQL
con `atlasSchemaFor(...)`. Ninguna cruza a un schema que el módulo no registre, salvo `systems-ops`, que lee el catálogo
de cualquier schema por diseño (lector gobernado; V44).

## Grants efectivos

`atlas_app_rw` tiene DML sobre las 200 tablas y no es propietario de ninguna (DDL denegado); `atlas_app_ro` sólo SELECT.
Es lo que `check:db-privileges --strict` verifica en CI. La separación por contexto (AT-019: un rol por contexto) todavía
no existe: hoy un módulo puede escribir cualquier tabla del monolito.
