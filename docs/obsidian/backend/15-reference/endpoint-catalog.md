---
title: "Catálogo de endpoints"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "reference"
  - "api"
  - "catalog"
---
# Catálogo de endpoints

**266 rutas** en **48 clases controller**. 16 públicas, 250 autenticadas.

> [!info] Verificado
> Extraído de los decoradores `@Controller`/`@Get`/`@Post`/… del código. Contraste con el contrato: `docs/endpoints/openapi.yaml` declara **265 operaciones**; el catálogo lista **266**. La diferencia es `GET /metrics`, excluido del prefijo `/api/v1` y del contrato a propósito (`main.ts:72`).

Todas las rutas se sirven bajo `/${API_PREFIX}` (por defecto `api/v1`) salvo `/metrics`.

| Método | Ruta | Tag | Auth | Roles | Controller |
|---|---|---|---|---|---|
| `GET` | `/admin/external-providers` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/:providerCode/cost-policy` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `PATCH` | `/admin/external-providers/:providerCode/cost-policy/:queryType` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` | `AdminExternalProvidersController` |
| `POST` | `/admin/external-providers/:providerCode/kill-switch` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `PATCH` | `/admin/external-providers/:providerCode/runtime` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` | `AdminExternalProvidersController` |
| `POST` | `/admin/external-providers/:providerCode/test` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/health` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/idempotency-audit` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `POST` | `/admin/external-providers/policy/preview` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/production-gate` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/quality-audit` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/readiness` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `POST` | `/admin/external-providers/requests/:requestId/approve` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` | `AdminExternalProvidersController` |
| `POST` | `/admin/external-providers/requests/:requestId/rebuild-features` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `POST` | `/admin/external-providers/requests/:requestId/retry` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/retention/preview` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/sanitization-audit` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/sla` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `GET` | `/admin/external-providers/usage` | [[04-api/rest/external-data-admin\|external-data-admin]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `AdminExternalProvidersController` |
| `POST` | `/auth/login` | [[04-api/rest/auth\|auth]] | 🔓 | — | `AuthController` |
| `POST` | `/auth/login/pin` | [[04-api/rest/auth\|auth]] | 🔓 | — | `AuthController` |
| `POST` | `/auth/logout` | [[04-api/rest/auth\|auth]] | 🔓 | — | `AuthController` |
| `GET` | `/auth/me` | [[04-api/rest/auth\|auth]] | 🔒 | — | `AuthController` |
| `POST` | `/auth/mfa` | [[04-api/rest/auth\|auth]] | 🔒 | — | `AuthController` |
| `POST` | `/auth/password-reset/confirm` | [[04-api/rest/auth\|auth]] | 🔓 | — | `AuthController` |
| `POST` | `/auth/password-reset/request` | [[04-api/rest/auth\|auth]] | 🔓 | — | `AuthController` |
| `POST` | `/auth/provision-credentials` | [[04-api/rest/auth\|auth]] | 🔓 | `admin` `platform_admin` | `AuthController` |
| `POST` | `/auth/refresh` | [[04-api/rest/auth\|auth]] | 🔓 | — | `AuthController` |
| `POST` | `/bureau/infocenter/check` | [[04-api/rest/bureau\|bureau]] | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` | `BureauExternalDataController` |
| `GET` | `/consent-documents/active` | [[04-api/rest/consents\|consents]] | 🔓 | — | `ConsentsController` |
| `POST` | `/customer-onboarding/:customerId/address-package` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CustomerOnboardingController` |
| `POST` | `/customer-onboarding/:customerId/contact-methods` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `...CUSTOMER_AND_INTERNAL` | `CustomerOnboardingProfileController` |
| `POST` | `/customer-onboarding/:customerId/contact-verification/request` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CustomerOnboardingController` |
| `POST` | `/customer-onboarding/:customerId/contact-verification/submit` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CustomerOnboardingController` |
| `POST` | `/customer-onboarding/:customerId/documents/upload-url` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `...CUSTOMER_AND_INTERNAL` | `CustomerOnboardingProfileController` |
| `PUT` | `/customer-onboarding/:customerId/financial-profile` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `...CUSTOMER_AND_INTERNAL` | `CustomerOnboardingProfileController` |
| `POST` | `/customer-onboarding/:customerId/identity-package` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CustomerOnboardingController` |
| `POST` | `/customer-onboarding/:customerId/identity-verification` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `...CUSTOMER_AND_INTERNAL` | `CustomerOnboardingProfileController` |
| `GET` | `/customer-onboarding/:customerId/observations` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CustomerOnboardingStatusController` |
| `PATCH` | `/customer-onboarding/:customerId/profile` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `...CUSTOMER_AND_INTERNAL` | `CustomerOnboardingProfileController` |
| `GET` | `/customer-onboarding/:customerId/reference-contacts` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `...CUSTOMER_AND_INTERNAL` | `CustomerOnboardingProfileController` |
| `POST` | `/customer-onboarding/:customerId/reference-contacts` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `...CUSTOMER_AND_INTERNAL` | `CustomerOnboardingProfileController` |
| `DELETE` | `/customer-onboarding/:customerId/reference-contacts/:referenceId` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `...CUSTOMER_AND_INTERNAL` | `CustomerOnboardingProfileController` |
| `GET` | `/customer-onboarding/:customerId/status` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CustomerOnboardingStatusController` |
| `POST` | `/customer-onboarding/:customerId/submit` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CustomerOnboardingStatusController` |
| `POST` | `/customer-onboarding/jobs/mark-abandoned` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `admin` `platform_admin` `system` | `CustomerOnboardingStatusController` |
| `POST` | `/customer-onboarding/start` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔓 | — | `CustomerOnboardingController` |
| `GET` | `/customers/:customerId/credit-applications` | [[04-api/rest/credit\|credit]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CreditController` |
| `POST` | `/customers/:customerId/credit-applications` | [[04-api/rest/credit\|credit]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CreditController` |
| `GET` | `/customers/:customerId/credit-products` | [[04-api/rest/credit\|credit]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CreditController` |
| `POST` | `/customers/:customerId/device-tokens` | [[04-api/rest/notifications\|notifications]] | 🔒 | `customer` `internal_operator` `admin` `platform_admin` `system` | `NotificationsController` |
| `DELETE` | `/customers/:customerId/device-tokens/:deviceTokenId` | [[04-api/rest/notifications\|notifications]] | 🔒 | `customer` `internal_operator` `admin` `platform_admin` `system` | `NotificationsController` |
| `GET` | `/customers/:customerId/eligibility` | [[04-api/rest/customer-eligibility\|customer-eligibility]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` | `CustomerEligibilityController` |
| `GET` | `/customers/:customerId/me` | [[04-api/rest/customers\|customers]] | 🔒 | `...` | `CustomersController` |
| `GET` | `/customers/:customerId/notifications` | [[04-api/rest/notifications\|notifications]] | 🔒 | `customer` `internal_operator` `admin` `platform_admin` `system` | `NotificationsController` |
| `POST` | `/customers/:customerId/notifications/:notificationId/read` | [[04-api/rest/notifications\|notifications]] | 🔒 | `customer` `internal_operator` `admin` `platform_admin` `system` | `NotificationsController` |
| `POST` | `/customers/:customerId/notifications/read-all` | [[04-api/rest/notifications\|notifications]] | 🔒 | `customer` `internal_operator` `admin` `platform_admin` `system` | `NotificationsController` |
| `GET` | `/customers/:customerId/notifications/unread-count` | [[04-api/rest/notifications\|notifications]] | 🔒 | `customer` `internal_operator` `admin` `platform_admin` `system` | `NotificationsController` |
| `POST` | `/customers/:customerId/privacy/consent-decisions` | [[04-api/rest/customer-privacy\|customer-privacy]] | 🔒 | `customer` `internal_operator` `compliance_analyst` `admin` `platform_admin` | `CustomerPrivacyController` |
| `POST` | `/customers/:customerId/privacy/data-subject-requests` | [[04-api/rest/customer-privacy\|customer-privacy]] | 🔒 | `customer` `internal_operator` `compliance_analyst` `admin` `platform_admin` | `CustomerPrivacyController` |
| `POST` | `/customers/:customerId/risk-assessments` | [[04-api/rest/risk\|risk]] | 🔒 | `customer` `internal_operator` `risk_analyst` `system` `admin` `platform_admin` | `RiskController` |
| `GET` | `/customers/:customerId/session-state` | [[04-api/rest/sessions\|sessions]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CustomerSessionsController` |
| `POST` | `/customers/:customerId/sessions/:sessionId/end` | [[04-api/rest/sessions\|sessions]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CustomerSessionsController` |
| `POST` | `/customers/:customerId/sessions/:sessionId/heartbeat` | [[04-api/rest/sessions\|sessions]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CustomerSessionsController` |
| `POST` | `/customers/:customerId/sessions/start` | [[04-api/rest/sessions\|sessions]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CustomerSessionsController` |
| `POST` | `/customers/:customerId/telemetry/batch` | [[04-api/rest/customer-telemetry\|customer-telemetry]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` | `CustomerTelemetryController` |
| `GET` | `/customers/:customerId/workflow-progress` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_PROGRESS_ROLES` | `WorkflowProgressController` |
| `POST` | `/digital-trust/check` | [[04-api/rest/digital-trust\|digital-trust]] | 🔒 | `customer` `internal_operator` `risk_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `DigitalTrustExternalDataController` |
| `GET` | `/digital-trust/profile/:customerId` | [[04-api/rest/digital-trust\|digital-trust]] | 🔒 | `customer` `internal_operator` `risk_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `DigitalTrustExternalDataController` |
| `POST` | `/external-data/consents` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `POST` | `/external-data/consents/:consentId/revoke` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `GET` | `/external-data/consents/user/:customerId` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `GET` | `/external-data/providers/health` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `POST` | `/external-data/requests` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `GET` | `/external-data/requests/:requestId` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `POST` | `/external-data/requests/preview` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `GET` | `/external-data/users/:customerId/decision-package` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `GET` | `/external-data/users/:customerId/features` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `GET` | `/external-data/users/:customerId/observations` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `GET` | `/external-data/users/:customerId/scoring-input` | [[04-api/rest/external-data\|external-data]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `ExternalDataController` |
| `GET` | `/health` | [[04-api/rest/health\|health]] | 🔓 | — | `HealthController` |
| `GET` | `/health/liveness` | [[04-api/rest/health\|health]] | 🔓 | — | `HealthController` |
| `GET` | `/health/readiness` | [[04-api/rest/health\|health]] | 🔓 | — | `HealthController` |
| `GET` | `/internal-users/me/notifications` | [[04-api/rest/notifications\|notifications]] | 🔒 | `...INTERNAL_SELF_SERVICE_ROLES` | `NotificationsController` |
| `POST` | `/internal-users/me/notifications/:notificationId/read` | [[04-api/rest/notifications\|notifications]] | 🔒 | `...INTERNAL_SELF_SERVICE_ROLES` | `NotificationsController` |
| `POST` | `/internal-users/me/notifications/read-all` | [[04-api/rest/notifications\|notifications]] | 🔒 | `...INTERNAL_SELF_SERVICE_ROLES` | `NotificationsController` |
| `GET` | `/internal-users/me/notifications/unread-count` | [[04-api/rest/notifications\|notifications]] | 🔒 | `...INTERNAL_SELF_SERVICE_ROLES` | `NotificationsController` |
| `GET` | `/internal/alerts` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `POST` | `/internal/alerts/:alertId/acknowledge` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `POST` | `/internal/auth/login` | [[04-api/rest/internal-auth\|internal-auth]] | 🔓 | — | `InternalAuthController` |
| `POST` | `/internal/auth/login/pin` | [[04-api/rest/internal-auth\|internal-auth]] | 🔓 | — | `InternalAuthController` |
| `POST` | `/internal/auth/logout` | [[04-api/rest/internal-auth\|internal-auth]] | 🔓 | — | `InternalAuthController` |
| `GET` | `/internal/auth/me` | [[04-api/rest/internal-auth\|internal-auth]] | 🔒 | — | `InternalAuthController` |
| `POST` | `/internal/auth/refresh` | [[04-api/rest/internal-auth\|internal-auth]] | 🔓 | — | `InternalAuthController` |
| `POST` | `/internal/auth/signup` | [[04-api/rest/internal-auth\|internal-auth]] | 🔒 | — | `InternalAuthController` |
| `GET` | `/internal/business-metadata/glossary` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/business-metadata/terms/:termId` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/data-quality/rules` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/data-quality/rules/:ruleId` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `POST` | `/internal/data-quality/rules/:ruleId/run` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/exports` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/exports/:exportId` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/governance/policies/:policyId` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `PATCH` | `/internal/governance/policies/:policyId` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/jobs` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/jobs/:jobRunId` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `POST` | `/internal/jobs/:jobRunId/cancel` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `POST` | `/internal/jobs/:jobRunId/retry` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/lineage` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/lineage/impact` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/lineage/nodes/:nodeId` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/permissions` | [[04-api/rest/internal-access-catalog\|internal-access-catalog]] | 🔒 | — | `InternalAccessCatalogController` |
| `GET` | `/internal/release-readiness` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/reports` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/reports/:reportId` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `POST` | `/internal/reports/:reportId/run` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/reports/:reportId/snapshots` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/roles` | [[04-api/rest/internal-access-catalog\|internal-access-catalog]] | 🔒 | — | `InternalAccessCatalogController` |
| `GET` | `/internal/roles/:roleId` | [[04-api/rest/internal-access-catalog\|internal-access-catalog]] | 🔒 | — | `InternalAccessCatalogController` |
| `GET` | `/internal/search` | [[04-api/rest/internal-portal\|internal-portal]] | 🔒 | `...INTERNAL_PORTAL_ROLES` | `InternalPortalController` |
| `GET` | `/internal/users` | [[04-api/rest/internal-users\|internal-users]] | 🔒 | — | `InternalUsersController` |
| `GET` | `/internal/users/:internalUserId` | [[04-api/rest/internal-users\|internal-users]] | 🔒 | — | `InternalUsersController` |
| `PATCH` | `/internal/users/:internalUserId` | [[04-api/rest/internal-users\|internal-users]] | 🔒 | — | `InternalUsersController` |
| `PATCH` | `/internal/users/:internalUserId/roles` | [[04-api/rest/internal-users\|internal-users]] | 🔒 | — | `InternalUsersController` |
| `GET` | `/internal/views/audit-events` | [[04-api/rest/internal-admin-views\|internal-admin-views]] | 🔒 | `...ADMIN_READ_ROLES` | `AdminReadController` |
| `GET` | `/internal/views/customers` | [[04-api/rest/internal-admin-views\|internal-admin-views]] | 🔒 | `...ADMIN_READ_ROLES` | `AdminReadController` |
| `GET` | `/internal/views/endpoint-coverage` | [[04-api/rest/internal-admin-views\|internal-admin-views]] | 🔒 | `...ADMIN_READ_ROLES` | `AdminReadController` |
| `GET` | `/internal/views/notification-deliveries` | [[04-api/rest/internal-admin-views\|internal-admin-views]] | 🔒 | `...ADMIN_READ_ROLES` | `AdminReadController` |
| `GET` | `/internal/views/provider-health` | [[04-api/rest/internal-admin-views\|internal-admin-views]] | 🔒 | `...ADMIN_READ_ROLES` | `AdminReadController` |
| `GET` | `/internal/views/risk-assessments` | [[04-api/rest/internal-admin-views\|internal-admin-views]] | 🔒 | `...ADMIN_READ_ROLES` | `AdminReadController` |
| `GET` | `/internal/views/work-queue` | [[04-api/rest/internal-admin-views\|internal-admin-views]] | 🔒 | `...ADMIN_READ_ROLES` | `AdminReadController` |
| `POST` | `/kyc/segip/verify` | [[04-api/rest/kyc\|kyc]] | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `KycExternalDataController` |
| `GET` | `/metrics` | — | 🔒 | — | `MetricsController` |
| `GET` | `/operations/audit/customer/:customerId` | [[04-api/rest/audit\|audit]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` | `AuditController` |
| `GET` | `/operations/audit/customer/:customerId/feed` | [[04-api/rest/audit\|audit]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` | `AuditController` |
| `POST` | `/operations/catalog-ingestions` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `POST` | `/operations/catalog-staging-items/decision-batch` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `GET` | `/operations/catalogs` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `POST` | `/operations/catalogs/:catalogCode/versions` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `GET` | `/operations/catalogs/:catalogCode/versions/:versionId` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `POST` | `/operations/catalogs/:catalogCode/versions/:versionId/decision` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `admin` `platform_admin` | `CatalogManagementController` |
| `POST` | `/operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `GET` | `/operations/credit/applications/:applicationId` | [[04-api/rest/credit\|credit]] | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` | `CreditOperationsController` |
| `POST` | `/operations/credit/applications/:applicationId/decision` | [[04-api/rest/credit\|credit]] | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` | `CreditOperationsController` |
| `GET` | `/operations/credit/products` | [[04-api/rest/credit\|credit]] | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` | `CreditOperationsController` |
| `POST` | `/operations/credit/products` | [[04-api/rest/credit\|credit]] | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` | `CreditOperationsController` |
| `PATCH` | `/operations/credit/products/:productId/status` | [[04-api/rest/credit\|credit]] | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` | `CreditOperationsController` |
| `POST` | `/operations/customers/:customerId/compliance/clear-matches` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `compliance_analyst` `admin` `platform_admin` | `CustomerVerificationController` |
| `POST` | `/operations/customers/:customerId/compliance/screening` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `compliance_analyst` `risk_analyst` `admin` `platform_admin` `system` | `CustomerVerificationController` |
| `POST` | `/operations/customers/:customerId/eligibility/decision` | [[04-api/rest/customer-eligibility\|customer-eligibility]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` `platform_admin` | `CustomerEligibilityController` |
| `POST` | `/operations/customers/:customerId/identity-verification/decision` | [[04-api/rest/customer-onboarding\|customer-onboarding]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` `platform_admin` | `CustomerVerificationController` |
| `GET` | `/operations/customers/:customerId/investigation-summary` | [[04-api/rest/operations\|operations]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` `platform_admin` | `OperationsController` |
| `GET` | `/operations/data-governance/policies` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `POST` | `/operations/data-governance/policy-package` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `GET` | `/operations/data-quality/issues` | [[04-api/rest/data-quality\|data-quality]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` `platform_admin` | `DataQualityController` |
| `POST` | `/operations/data-quality/issues/:issueId/resolve` | [[04-api/rest/data-quality\|data-quality]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` `platform_admin` | `DataQualityController` |
| `GET` | `/operations/definitions` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `POST` | `/operations/definitions/package` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `GET` | `/operations/events` | [[04-api/rest/events\|events]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `EventsController` |
| `POST` | `/operations/events` | [[04-api/rest/events\|events]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `EventsController` |
| `GET` | `/operations/events/:eventId` | [[04-api/rest/events\|events]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `EventsController` |
| `POST` | `/operations/events/:eventId/cancel` | [[04-api/rest/events\|events]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `EventsController` |
| `POST` | `/operations/events/:eventId/retry` | [[04-api/rest/events\|events]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `EventsController` |
| `GET` | `/operations/events/catalog` | [[04-api/rest/events\|events]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `EventsController` |
| `GET` | `/operations/fraud-cases` | [[04-api/rest/operations\|operations]] | 🔒 | `fraud_analyst` `internal_operator` `risk_analyst` `compliance_analyst` `admin` `platform_admin` | `OperationsController` |
| `POST` | `/operations/fraud-cases/:caseId/decision` | [[04-api/rest/operations\|operations]] | 🔒 | `fraud_analyst` `admin` `platform_admin` | `OperationsController` |
| `POST` | `/operations/jobs/apply-retention-policies` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `POST` | `/operations/jobs/deliver-pending-notifications` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `POST` | `/operations/jobs/expire-stale-sessions` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `POST` | `/operations/jobs/process-events` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `POST` | `/operations/jobs/process-outbox` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `POST` | `/operations/jobs/purge-idempotency-keys` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `POST` | `/operations/jobs/recalculate-data-quality` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `POST` | `/operations/jobs/reclaim-stuck-events` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `POST` | `/operations/jobs/retry-stuck-notifications` | [[04-api/rest/runtime-jobs\|runtime-jobs]] | 🔒 | `admin` `platform_admin` `system` | `RuntimeJobsController` |
| `GET` | `/operations/manual-review-cases` | [[04-api/rest/operations\|operations]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` `platform_admin` | `OperationsController` |
| `POST` | `/operations/manual-review-cases/:caseId/decision` | [[04-api/rest/operations\|operations]] | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` | `OperationsController` |
| `POST` | `/operations/notifications/broadcast` | [[04-api/rest/notifications\|notifications]] | 🔒 | `admin` `platform_admin` `system` | `NotificationsController` |
| `GET` | `/operations/notifications/messages` | [[04-api/rest/notifications\|notifications]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `NotificationsController` |
| `GET` | `/operations/notifications/messages/:messageId` | [[04-api/rest/notifications\|notifications]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `NotificationsController` |
| `POST` | `/operations/notifications/messages/:messageId/cancel` | [[04-api/rest/notifications\|notifications]] | 🔒 | `admin` `platform_admin` `system` `internal_operator` | `NotificationsController` |
| `POST` | `/operations/notifications/messages/:messageId/retry` | [[04-api/rest/notifications\|notifications]] | 🔒 | `admin` `platform_admin` `system` `internal_operator` | `NotificationsController` |
| `GET` | `/operations/notifications/preferences/:customerId` | [[04-api/rest/notifications\|notifications]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `NotificationsController` |
| `PATCH` | `/operations/notifications/preferences/:customerId` | [[04-api/rest/notifications\|notifications]] | 🔒 | `admin` `platform_admin` `system` `internal_operator` | `NotificationsController` |
| `GET` | `/operations/notifications/templates` | [[04-api/rest/notifications\|notifications]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `NotificationsController` |
| `POST` | `/operations/notifications/templates` | [[04-api/rest/notifications\|notifications]] | 🔒 | `admin` `platform_admin` `system` | `NotificationsController` |
| `PATCH` | `/operations/notifications/templates/:templateId` | [[04-api/rest/notifications\|notifications]] | 🔒 | `admin` `platform_admin` `system` | `NotificationsController` |
| `GET` | `/operations/risk-assessments/:riskAssessmentRunId` | [[04-api/rest/risk\|risk]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` | `RiskController` |
| `GET` | `/operations/risk-assessments/:riskAssessmentRunId/explanation` | [[04-api/rest/risk\|risk]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` | `RiskController` |
| `GET` | `/operations/risk-policy/current` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `POST` | `/operations/risk-policy/ruleset-versions` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `CatalogManagementController` |
| `POST` | `/operations/risk-policy/ruleset-versions/:rulesetVersionId/activate` | [[04-api/rest/catalog-management\|catalog-management]] | 🔒 | `admin` `platform_admin` | `CatalogManagementController` |
| `GET` | `/operations/schema/change-log` | [[04-api/rest/schema-management\|schema-management]] | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` `readonly_auditor` | `SchemaManagementController` |
| `PATCH` | `/operations/schema/change-log/:changeId/approve` | [[04-api/rest/schema-management\|schema-management]] | 🔒 | `platform_admin` | `SchemaManagementController` |
| `GET` | `/operations/schema/tables` | [[04-api/rest/schema-management\|schema-management]] | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` `readonly_auditor` | `SchemaManagementController` |
| `POST` | `/operations/schema/tables` | [[04-api/rest/schema-management\|schema-management]] | 🔒 | `internal_operator` `admin` `platform_admin` | `SchemaManagementController` |
| `GET` | `/operations/schema/tables/:tableId` | [[04-api/rest/schema-management\|schema-management]] | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` `readonly_auditor` | `SchemaManagementController` |
| `GET` | `/operations/schema/versions` | [[04-api/rest/schema-management\|schema-management]] | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` `readonly_auditor` | `SchemaManagementController` |
| `GET` | `/operations/schema/versions/:versionId` | [[04-api/rest/schema-management\|schema-management]] | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` `readonly_auditor` | `SchemaManagementController` |
| `GET` | `/operations/sessions/:sessionId/investigation-summary` | [[04-api/rest/sessions\|sessions]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `OperationsSessionsController` |
| `GET` | `/operations/work-queue` | [[04-api/rest/operations\|operations]] | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` `platform_admin` | `OperationsController` |
| `GET` | `/operations/workflows/:workflowCode/consistency` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_CATALOG_GOVERNANCE_ROLES` | `WorkflowOperationsController` |
| `POST` | `/payments/bank-transfer/qr` | [[04-api/rest/payments-external\|payments-external]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `PaymentsExternalDataController` |
| `POST` | `/payments/bank-transfer/verify` | [[04-api/rest/payments-external\|payments-external]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `PaymentsExternalDataController` |
| `POST` | `/payments/qr/verify` | [[04-api/rest/payments-external\|payments-external]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `PaymentsExternalDataController` |
| `POST` | `/social/facebook/callback` | [[04-api/rest/social\|social]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `FacebookExternalDataController` |
| `GET` | `/social/facebook/connect-url` | [[04-api/rest/social\|social]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `FacebookExternalDataController` |
| `GET` | `/social/facebook/status/:customerId` | [[04-api/rest/social\|social]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `FacebookExternalDataController` |
| `GET` | `/systems/action-logs` | — | 🔒 | — | `SystemsActionLogController` |
| `GET` | `/systems/action-logs/by-request/:requestId` | — | 🔒 | — | `SystemsActionLogController` |
| `GET` | `/systems/action-logs/request/:requestId` | — | 🔒 | — | `SystemsActionLogController` |
| `GET` | `/systems/dashboard` | — | 🔒 | — | `SystemsCatalogController` |
| `GET` | `/systems/data-entities` | — | 🔒 | — | `SystemsCatalogController` |
| `GET` | `/systems/data-entities/:entityId` | — | 🔒 | — | `SystemsCatalogController` |
| `PATCH` | `/systems/data-entities/:entityId/metadata` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsCatalogController` |
| `PATCH` | `/systems/data-entities/:entityId/review` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsReviewController` |
| `PATCH` | `/systems/data-entities/columns/:columnId/review` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsReviewController` |
| `POST` | `/systems/data-entities/infer-impacts` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsCatalogController` |
| `GET` | `/systems/domains` | — | 🔒 | — | `SystemsCatalogController` |
| `GET` | `/systems/domains/:domainCode` | — | 🔒 | — | `SystemsCatalogController` |
| `GET` | `/systems/endpoints` | — | 🔒 | — | `SystemsCatalogController` |
| `GET` | `/systems/endpoints/:endpointId` | — | 🔒 | — | `SystemsCatalogController` |
| `PATCH` | `/systems/endpoints/:endpointId/review` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsReviewController` |
| `POST` | `/systems/endpoints/catalog-seed/refresh` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsCatalogController` |
| `POST` | `/systems/endpoints/discover` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsCatalogController` |
| `GET` | `/systems/health/tools` | — | 🔒 | — | `SystemsCatalogController` |
| `GET` | `/systems/impact/by-endpoint/:endpointId` | — | 🔒 | — | `SystemsCatalogController` |
| `GET` | `/systems/impact/by-table/:schemaName/:tableName` | — | 🔒 | — | `SystemsCatalogController` |
| `PATCH` | `/systems/impact/data/:impactId/review` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsReviewController` |
| `PATCH` | `/systems/impact/fields/:fieldImpactId/review` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsReviewController` |
| `GET` | `/systems/logs/mongo` | — | 🔒 | — | `MongoLogsController` |
| `GET` | `/systems/reports/traffic-latency` | — | 🔒 | — | `SystemsActionLogController` |
| `GET` | `/systems/reports/traffic-latency-timeseries` | — | 🔒 | — | `SystemsActionLogController` |
| `GET` | `/systems/review-queue` | — | 🔒 | — | `SystemsReviewController` |
| `GET` | `/systems/stress-matrix` | — | 🔒 | — | `SystemsStressController` |
| `GET` | `/systems/stress-profiles` | — | 🔒 | — | `SystemsStressController` |
| `POST` | `/systems/stress-profiles` | — | 🔒 | `...SYSTEMS_OPS_STRESS_ROLES` | `SystemsStressController` |
| `GET` | `/systems/stress-profiles/:profileId` | — | 🔒 | — | `SystemsStressController` |
| `POST` | `/systems/stress-profiles/:profileId/queue-run` | — | 🔒 | `...SYSTEMS_OPS_STRESS_ROLES` | `SystemsStressController` |
| `GET` | `/systems/stress-runs` | — | 🔒 | — | `SystemsStressController` |
| `GET` | `/systems/test-runs` | — | 🔒 | — | `SystemsTestController` |
| `GET` | `/systems/test-runs/:runId` | — | 🔒 | — | `SystemsTestController` |
| `GET` | `/systems/test-suites` | — | 🔒 | — | `SystemsTestController` |
| `POST` | `/systems/test-suites` | — | 🔒 | `...SYSTEMS_OPS_QA_ROLES` | `SystemsTestController` |
| `GET` | `/systems/test-suites/:suiteId` | — | 🔒 | — | `SystemsTestController` |
| `PATCH` | `/systems/test-suites/:suiteId` | — | 🔒 | `...SYSTEMS_OPS_QA_ROLES` | `SystemsTestController` |
| `POST` | `/systems/test-suites/:suiteId/run` | — | 🔒 | `...SYSTEMS_OPS_QA_ROLES` | `SystemsTestController` |
| `POST` | `/systems/test-suites/:suiteId/steps` | — | 🔒 | `...SYSTEMS_OPS_QA_ROLES` | `SystemsTestController` |
| `PATCH` | `/systems/test-suites/:suiteId/steps/:stepId` | — | 🔒 | `...SYSTEMS_OPS_QA_ROLES` | `SystemsTestController` |
| `POST` | `/systems/test-suites/:suiteId/steps/reorder` | — | 🔒 | `...SYSTEMS_OPS_QA_ROLES` | `SystemsTestController` |
| `GET` | `/systems/tools` | — | 🔒 | — | `SystemsCatalogController` |
| `GET` | `/systems/tools/:toolId` | — | 🔒 | — | `SystemsCatalogController` |
| `POST` | `/systems/tools/infer-requirements` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsCatalogController` |
| `PATCH` | `/systems/tools/requirements/:requirementId/review` | — | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` | `SystemsReviewController` |
| `GET` | `/telco/phone-trust/:customerId` | [[04-api/rest/telco\|telco]] | 🔒 | `customer` `internal_operator` `risk_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `TelcoExternalDataController` |
| `POST` | `/telco/phone-trust/verify` | [[04-api/rest/telco\|telco]] | 🔒 | `customer` `internal_operator` `risk_analyst` `fraud_analyst` `admin` `platform_admin` `system` | `TelcoExternalDataController` |
| `GET` | `/whatsapp/status/:customerId` | [[04-api/rest/whatsapp\|whatsapp]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `WhatsappExternalDataController` |
| `POST` | `/whatsapp/verification/confirm` | [[04-api/rest/whatsapp\|whatsapp]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `WhatsappExternalDataController` |
| `POST` | `/whatsapp/verification/start` | [[04-api/rest/whatsapp\|whatsapp]] | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` `platform_admin` `system` | `WhatsappExternalDataController` |
| `GET` | `/workflows` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` | `WorkflowCatalogController` |
| `GET` | `/workflows/:workflowCode` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` | `WorkflowCatalogController` |
| `GET` | `/workflows/:workflowCode/graph` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` | `WorkflowCatalogController` |
| `GET` | `/workflows/:workflowCode/stages` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` | `WorkflowCatalogController` |
| `GET` | `/workflows/:workflowCode/transitions` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` | `WorkflowCatalogController` |
| `POST` | `/workflows/:workflowCode/transitions/validate` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` | `WorkflowCatalogController` |
| `GET` | `/workflows/:workflowCode/versions` | [[04-api/rest/workflow-catalog\|workflow-catalog]] | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` | `WorkflowCatalogController` |

## Relaciones

- Índice de API: [[04-api/index]] · Matriz de permisos: [[15-reference/permissions-matrix]]
