# Matriz de roles y permisos — Admin Backend Atlas

Generada a partir del código actual (`@Roles(...)` / `@InternalPermissions(...)` en cada controller).
Actualizar este archivo cuando se agregue o cambie un endpoint con `@Roles`/`@InternalPermissions`.

Convenciones:

- **Tenant**: todos los endpoints bajo un controller con `x-tenant-id` en sus headers exigen que ese
  header coincida con el `tenantId` del JWT (`TenantGuard`, ver `src/common/guards/tenant.guard.ts`).
  Los actores `platform_user` (tokens sin `tenantId`) pueden operar cualquier tenant.
- **Idempotencia**: los endpoints mutantes (`POST`/`PATCH`/`DELETE`) que además exigen
  `x-idempotency-key` están marcados con ✅ en esa columna; el `IdempotencyInterceptor` global lo
  aplica automáticamente a cualquier mutación que envíe ese header, pero solo algunos endpoints lo
  **exigen** (`BadRequestException` si falta).
- Un endpoint sin fila propia en un controller con `@Roles(...)` a nivel de clase hereda esos roles.

## `audit` — `/operations/audit`

Roles de clase: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`

| Endpoint | Rol | Acción | Riesgo | Auditoría |
|---|---|---|---|---|
| `GET customer/:customerId` | (roles de clase) | Historial de auditoría del cliente (offset) | Bajo (solo lectura) | N/A |
| `GET customer/:customerId/feed` | (roles de clase) | Feed de auditoría por cursor | Bajo | N/A |

## `auth` — `/auth`

| Endpoint | Rol | Idempotencia | Riesgo | Auditoría |
|---|---|---|---|---|
| `POST login` | público | — | Medio (fuerza bruta — throttled) | `auth_credentials` / eventos de login |
| `POST refresh` | público | — | Medio (rotación de refresh token) | Sí |
| `POST logout` | público | — | Bajo | Sí |
| `POST provision-credentials` | `admin`, `platform_admin` | — | Alto (crea credencial de acceso) | Sí |

## `catalog-management` — `/operations`

Roles de clase: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`

| Endpoint | Rol | Idempotencia | Riesgo | Tabla afectada |
|---|---|---|---|---|
| `GET catalogs` | (roles de clase) | — | Bajo | `context_catalogs` |
| `GET catalogs/:catalogCode/versions/:versionId` | (roles de clase) | — | Bajo | `context_catalog_versions` |
| `POST catalogs/:catalogCode/versions` | (roles de clase) | ✅ | Medio | `context_catalog_versions` |
| `POST catalogs/:catalogCode/versions/:versionId/submit-for-approval` | (roles de clase) | ✅ | Medio | `context_catalog_versions` |
| `POST catalogs/:catalogCode/versions/:versionId/decision` | `admin`, `platform_admin` | ✅ | Alto (aprueba/rechaza) | `context_catalog_versions` |
| `POST catalog-ingestions` | (roles de clase) | ✅ | Alto (ingesta masiva) | `catalog_ingestion_batches` |
| `POST catalog-staging-items/decision-batch` | (roles de clase) | ✅ | Alto | `catalog_staging_items` |
| `GET definitions` | (roles de clase) | — | Bajo | `ml_definitions` |
| `POST definitions/package` | (roles de clase) | ✅ | Medio | `ml_definitions` |
| `GET risk-policy/current` | (roles de clase) | — | Bajo | `risk_policy_rulesets` |
| `POST risk-policy/ruleset-versions` | (roles de clase) | ✅ | Alto (define reglas de riesgo) | `risk_policy_rulesets` |
| `POST risk-policy/ruleset-versions/:rulesetVersionId/activate` | `admin`, `platform_admin` | ✅ | Alto (activa reglas en producción) | `risk_policy_rulesets` |
| `GET data-governance/policies` | (roles de clase) | — | Bajo | `data_governance_policies` |
| `POST data-governance/policy-package` | (roles de clase) | ✅ | Medio | `data_governance_policies` |

## `customer-onboarding` — `/customer-onboarding`

| Endpoint | Rol | Idempotencia | Riesgo |
|---|---|---|---|
| `POST start` | público (throttled 10/min/IP) | ✅ | Alto (crea cliente + credenciales) |
| `POST :customerId/contact-verification/request` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | Medio |
| `POST :customerId/contact-verification/submit` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | Medio |
| `POST :customerId/identity-package` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | Alto (datos de identidad) |
| `POST :customerId/address-package` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | Medio |

## `customer-privacy` — `/customers/:customerId/privacy`

Roles de clase: `customer`, `internal_operator`, `compliance_analyst`, `admin`, `platform_admin`

| Endpoint | Riesgo |
|---|---|
| `POST consent-decisions` | Medio |
| `POST data-subject-requests` | Alto (derechos ARCO/GDPR-like) |

## `customer-telemetry` — `/customers/:customerId/telemetry`

Roles de clase: `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` — `POST batch` (bajo, solo ingesta).

## `customers` — `/customers`

| Endpoint | Rol |
|---|---|
| `GET :customerId/me` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` |

## `data-quality` — `/operations/data-quality/issues`

Roles de clase: `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`

| Endpoint | Riesgo |
|---|---|
| `GET` | Bajo |
| `POST :issueId/resolve` | Medio (cierra hallazgo de calidad de datos) |

## `events` — `/operations/events`

Roles de clase: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`

`GET catalog`, `GET`, `GET :eventId` (lectura, bajo) · `POST` (alto, publica evento) · `POST :eventId/retry` / `POST :eventId/cancel` (medio, jobs).

## `external-data` — múltiples prefijos (`/external-data`, `/admin/external-providers`, `/kyc`, `/bureau`, `/payments`, `/telco`, `/social/facebook`, `/whatsapp`, `/digital-trust`)

Cada bloque de rutas define su propio `@Roles(...)` de clase (ver tabla resumen):

| Prefijo | Roles de clase | Nota |
|---|---|---|
| `/external-data` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | Consentimientos y requests a proveedores externos |
| `/admin/external-providers` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | Overrides `admin`-only en `PATCH :providerCode/runtime`, `PATCH :providerCode/cost-policy/...`, `POST requests/:requestId/approve` |
| `/kyc` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | Verificación SEGIP |
| `/bureau` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | Consulta buró (Infocenter) — sin rol `customer` |
| `/payments` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | Verificación QR / transferencia bancaria |
| `/telco` | `customer`, `internal_operator`, `risk_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | Confianza de teléfono |
| `/social/facebook` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | OAuth Facebook |
| `/whatsapp` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | Verificación WhatsApp |
| `/digital-trust` | `customer`, `internal_operator`, `risk_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | Score de confianza digital |

Todas las mutaciones (`POST`/`PATCH`) aceptan `x-idempotency-key`; ver `external-data.controller.ts` para el detalle exacto por endpoint.

## `internal-portal` — `/internal`

Roles de clase: `INTERNAL_PORTAL_ROLES` (ver `internal-portal.controller.ts`) — glosario, exports, calidad de datos,
gobernanza, lineage, alertas, jobs, reportes, búsqueda. Todo de solo-operación interna, ningún endpoint expuesto a `customer`.

## `internal-auth` / `internal-users` / `internal-access-catalog` — `/internal/auth`, `/internal/users`, `/internal/roles`, `/internal/permissions`

Estos NO usan `@Roles(...)` sino permisos granulares (`@InternalPermissions(...)`, `InternalPermissionsGuard`):

| Endpoint | Permiso requerido |
|---|---|
| `POST /internal/auth/login` | público |
| `POST /internal/auth/refresh` | público |
| `POST /internal/auth/logout` | público |
| `GET /internal/auth/me` | `auth.internal.me.read` |
| `POST /internal/auth/signup` | `internal.users.manage` **y** `internal.roles.manage` |
| `GET /internal/users` | `internal.users.read` |
| `GET /internal/users/:internalUserId` | `internal.users.read` |
| `PATCH /internal/users/:internalUserId` | `internal.users.manage` |
| `PATCH /internal/users/:internalUserId/roles` | `internal.users.manage` **y** `internal.roles.manage` |
| `GET /internal/roles` | `internal.roles.read` |
| `GET /internal/roles/:roleId` | `internal.roles.read` |
| `GET /internal/permissions` | `internal.permissions.read` |

## `notifications` — mixto (`/operations/notifications/...`, `/customers/:customerId/notifications/...`)

| Endpoint | Rol |
|---|---|
| `GET operations/notifications/messages(/:messageId)` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` |
| `POST .../:messageId/retry` \| `cancel` | `admin`, `platform_admin`, `system`, `internal_operator` |
| `GET operations/notifications/templates` | (mismo set de lectura de arriba) |
| `POST` / `PATCH operations/notifications/templates(/:templateId)` | `admin`, `platform_admin`, `system` (sin `internal_operator`) |
| `GET`/`PATCH operations/notifications/preferences/:customerId` | lectura: set amplio · escritura: `admin`, `platform_admin`, `system`, `internal_operator` |
| `customers/:customerId/notifications/...` (listar, marcar leído, device tokens) | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` |

## `operations` — `/operations`

Roles de clase: `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`

| Endpoint | Rol | Riesgo |
|---|---|---|
| `GET work-queue` | (roles de clase) | Bajo |
| `GET manual-review-cases` | (roles de clase) | Bajo |
| `GET fraud-cases` | `fraud_analyst`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | Bajo |
| `GET customers/:customerId/investigation-summary` | (roles de clase) | Medio (expone perfil de riesgo agregado) |
| `POST manual-review-cases/:caseId/decision` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | Alto (decide sobre el cliente) |
| `POST fraud-cases/:caseId/decision` | `fraud_analyst`, `admin`, `platform_admin` | Alto |

## `risk` — sin prefijo de clase (`/customers/:customerId/risk-assessments`, `/operations/risk-assessments/...`)

| Endpoint | Rol | Riesgo |
|---|---|---|
| `POST customers/:customerId/risk-assessments` | `customer`, `internal_operator`, `risk_analyst`, `system`, `admin`, `platform_admin` | Alto (genera decisión de riesgo) |
| `GET operations/risk-assessments/:riskAssessmentRunId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | Medio (desglose interno del score — nunca `customer`) |
| `GET .../explanation` | (mismos roles internos) | Medio |

## `runtime-jobs` — `/operations/jobs`

Roles de clase: `admin`, `platform_admin`, `system` — jobs de mantenimiento (`process-outbox`, `process-events`,
`expire-stale-sessions`, `apply-retention-policies`, `recalculate-data-quality`). Riesgo alto por definición
(operan sobre datos en bulk); exigen `x-idempotency-key`.

## `schema-management` — `/operations/schema`

| Endpoint | Rol |
|---|---|
| `GET versions`, `GET versions/:versionId`, `GET tables`, `GET tables/:tableId`, `GET change-log` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor` |
| `POST tables` | `internal_operator`, `admin`, `platform_admin` |
| `PATCH change-log/:changeId/approve` | `platform_admin` únicamente |

## `sessions` — `/customers/:customerId` y `/operations/sessions`

| Endpoint | Rol |
|---|---|
| `POST sessions/start` \| `heartbeat` \| `end`, `GET session-state` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` |
| `GET operations/sessions/:sessionId/investigation-summary` | mismo set, sin `customer` en la práctica (ver ownership check en el service) |

## `systems-ops` — `/systems` (catalog, review, stress, test)

Lectura generalmente abierta a cualquier rol autenticado del set interno; mutaciones (`discover`,
`catalog-seed/refresh`, `infer-requirements`, `metadata` PATCH, `review` PATCH, `queue-run`, `test-suites`
POST/PATCH) requieren `SYSTEMS_OPS_WRITE_ROLES` (ver `systems-controller.decorators.ts`).

---

**Cómo mantener esto al día:** cuando agregues un endpoint nuevo con `@Roles(...)` o
`@InternalPermissions(...)`, agrega su fila aquí en el mismo commit. Si un endpoint no tiene fila y no
hereda roles de clase, es un endpoint público (`@Public()`) — verificar que eso sea intencional.
