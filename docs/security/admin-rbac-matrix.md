# Matriz de roles y permisos — AtlasBackend

> **Generada.** No se edita a mano: `yarn docs:rbac-matrix` la escribe desde la metadata de los
> controladores y `yarn check:rbac-matrix` (CI, job `contract-and-docs`) falla si el archivo versionado
> difiere del código. Fuente: `scripts/docs/generate-rbac-matrix.ts`.

## Cómo se lee

- **Acceso** es lo que exige `RolesGuard` (global, `APP_GUARD`) con la regla `getAllAndOverride([handler, clase])`:
  el `@Roles` del método manda sobre el de la clase. `JwtAuthGuard` también es global: **toda ruta exige
  sesión salvo las marcadas `@Public`**. No hay rutas públicas por omisión; una ruta que no aparece aquí no existe.
- **Permiso fino** (`@InternalPermissions`) se exige **además** del rol, sólo a sesiones internas, y lo hace
  cumplir el guard que figura en *Notas* (`InternalPermissionsGuard` o `SchemaChangeAuthorizationGuard`,
  que delega en él). El generador falla si una ruta declara un permiso sin guard que lo aplique.
- **Sin sesión** no siempre es «abierta»: varias rutas `@Public` comprueban otra credencial (clave del Motor,
  firma del proveedor de notificaciones, token de un solo uso). Las que la comprueban con un guard lo dicen
  en *Acceso* o en *Notas*; las que la comprueban dentro del handler están congeladas por
  `yarn check:auth-coverage` (`.auth-coverage-baseline.json`).
- **Tenant**: `TenantGuard` exige que el `x-tenant-id` coincida con el `tenantId` del token (salvo
  `platform_user`); ver `src/common/guards/tenant.guard.ts`.
- Las rutas van sin el prefijo global `/api/v1`.

## Resumen

| Superficie | Rutas |
|---|---:|
| Total montadas (129 controladores) | 604 |
| Fuera del contrato OpenAPI (`@ApiExcludeController`/`@ApiExcludeEndpoint`) | 10 |
| Sin sesión de usuario (`@Public`) | 29 |
| Credencial de servicio (`@ServiceScope` / `@SignedEventSource`) | 5 |
| Con `@Roles` | 546 |
| Con permiso fino `@InternalPermissions` (además del rol) | 79 |
| Cualquier sesión autenticada (sin `@Roles`) | 24 |

## `app-content`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/app-content` | **sin sesión** (`@Public`) | — | `AppContentController.list` | guards: `TenantGuard` |
| `GET` | `/operations/app-content` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `admin`, `platform_admin` | — | `AppContentOperationsController.list` | guards: `TenantGuard` |
| `PUT` | `/operations/app-content` | `admin`, `platform_admin` | — | `AppContentOperationsController.upsert` | guards: `TenantGuard` |
| `DELETE` | `/operations/app-content/:contentId` | `admin`, `platform_admin` | — | `AppContentOperationsController.remove` | guards: `TenantGuard` |

## `assist`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/internal/assist/chat` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `merchant` | — | `PortalAssistController.chat` | guards: `TenantGuard` |
| `GET` | `/internal/assist/conversation` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `merchant` | — | `PortalAssistController.conversation` | guards: `TenantGuard` |
| `GET` | `/internal/assist/conversations` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `merchant` | — | `PortalAssistController.conversations` | guards: `TenantGuard` |
| `DELETE` | `/internal/assist/conversations/:id` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `merchant` | — | `PortalAssistController.deleteConversation` | guards: `TenantGuard` |
| `GET` | `/internal/assist/conversations/:id` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `merchant` | — | `PortalAssistController.conversationById` | guards: `TenantGuard` |
| `POST` | `/mobile/assist/chat` | `customer` | — | `AssistController.chat` | guards: `TenantGuard` |
| `GET` | `/mobile/assist/conversation` | `customer` | — | `AssistController.conversation` | guards: `TenantGuard` |
| `GET` | `/mobile/assist/conversations` | `customer` | — | `AssistController.conversations` | guards: `TenantGuard` |
| `DELETE` | `/mobile/assist/conversations/:id` | `customer` | — | `AssistController.deleteConversation` | guards: `TenantGuard` |
| `GET` | `/mobile/assist/conversations/:id` | `customer` | — | `AssistController.conversationById` | guards: `TenantGuard` |

## `audit`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/operations/audit/customer/:customerId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `AuditController.getCustomerAudit` | guards: `TenantGuard` |
| `GET` | `/operations/audit/customer/:customerId/feed` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `AuditController.getCustomerAuditFeed` | guards: `TenantGuard` |

## `auth`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/auth/login` | **sin sesión** (`@Public`) | — | `AuthController.login` | guards: `TenantGuard` |
| `POST` | `/auth/login/pin` | **sin sesión** (`@Public`) | — | `AuthController.verifyLoginPin` | guards: `TenantGuard` |
| `POST` | `/auth/logout` | **sin sesión** (`@Public`) | — | `AuthController.logout` | guards: `TenantGuard` |
| `GET` | `/auth/me` | cualquier sesión autenticada | — | `AuthController.getMe` | guards: `TenantGuard` |
| `POST` | `/auth/mfa` | cualquier sesión autenticada | — | `AuthController.setMfaPreference` | guards: `TenantGuard` |
| `POST` | `/auth/password-reset/confirm` | **sin sesión** (`@Public`) | — | `AuthController.confirmPasswordReset` | guards: `TenantGuard` |
| `POST` | `/auth/password-reset/request` | **sin sesión** (`@Public`) | — | `AuthController.requestPasswordReset` | guards: `TenantGuard` |
| `POST` | `/auth/password/change/confirm` | cualquier sesión autenticada | — | `AuthPasswordChangeController.confirmPasswordChange` | guards: `TenantGuard` |
| `POST` | `/auth/password/change/request` | cualquier sesión autenticada | — | `AuthPasswordChangeController.requestPasswordChange` | guards: `TenantGuard` |
| `POST` | `/auth/pin/verify` | `customer` | — | `AuthPinVerifyController.verify` | guards: `TenantGuard` |
| `POST` | `/auth/provision-credentials` | `admin`, `platform_admin` | — | `AuthController.provisionCredentials` | guards: `TenantGuard` |
| `POST` | `/auth/refresh` | **sin sesión** (`@Public`) | — | `AuthController.refresh` | guards: `TenantGuard` |

## `catalog-management`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/operations/catalog-ingestions` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.ingestCatalog` | guards: `TenantGuard` |
| `GET` | `/operations/catalog-staging-items` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.listStagingItems` | guards: `TenantGuard` |
| `POST` | `/operations/catalog-staging-items/decision-batch` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.decideStagingItems` | guards: `TenantGuard` |
| `GET` | `/operations/catalogs` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.listCatalogs` | guards: `TenantGuard` |
| `POST` | `/operations/catalogs/:catalogCode/versions` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.createCatalogVersion` | guards: `TenantGuard` |
| `GET` | `/operations/catalogs/:catalogCode/versions/:versionId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.getCatalogVersion` | guards: `TenantGuard` |
| `POST` | `/operations/catalogs/:catalogCode/versions/:versionId/decision` | `admin`, `platform_admin` | — | `CatalogManagementController.decideCatalogVersion` | guards: `TenantGuard` |
| `POST` | `/operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.submitCatalogVersion` | guards: `TenantGuard` |
| `GET` | `/operations/data-governance/policies` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `governance.policies.read` | `CatalogGovernanceController.getDataGovernancePolicies` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/operations/data-governance/policies/search` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `governance.policies.read` | `CatalogGovernanceController.searchDataGovernancePolicies` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/data-governance/policy-package` | `internal_operator`, `admin`, `platform_admin` | `governance.policies.manage` | `CatalogGovernanceController.upsertDataGovernancePackage` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/operations/definitions` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.listDefinitions` | guards: `TenantGuard` |
| `POST` | `/operations/definitions/package` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CatalogManagementController.upsertDefinitionsPackage` | guards: `TenantGuard` |
| `GET` | `/operations/risk-policy/current` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CatalogGovernanceController.getCurrentRiskPolicy` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/risk-policy/ruleset-versions` | `admin`, `platform_admin` | — | `CatalogGovernanceController.createRiskRulesetVersion` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/risk-policy/ruleset-versions/:rulesetVersionId/activate` | `admin`, `platform_admin` | — | `CatalogGovernanceController.activateRiskRulesetVersion` | guards: `TenantGuard`, `InternalPermissionsGuard` |

## `consents`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/consent-documents/active` | **sin sesión** (`@Public`) | — | `ConsentsController.listActiveDocuments` | guards: `TenantGuard` |
| `GET` | `/operations/consent-documents` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `governance.policies.read` | `ConsentOperationsController.list` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/consent-documents` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `governance.policies.manage` | `ConsentOperationsController.create` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `PATCH` | `/operations/consent-documents/:documentId` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `governance.policies.manage` | `ConsentOperationsController.update` | guards: `TenantGuard`, `InternalPermissionsGuard` |

## `credit`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/customers/:customerId/bank-statements` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `BankStatementArchiveController.list` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/bank-statements` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditController.submitBankStatement` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/bank-statements/:reviewId/file` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `BankStatementArchiveController.file` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/bank-statements/latest` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditController.latestBankStatement` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/credit-applications` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditController.listApplications` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/credit-applications` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditController.createApplication` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/credit-line` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditController.creditLine` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/credit-line/history` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditController.creditLineHistory` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/credit-products` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditController.listProducts` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/progress` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditProgressController.progressOf` | guards: `TenantGuard` |
| `POST` | `/internal/credit/bank-statement-review-callback` | sin sesión · clave del Motor (`x-engine-callback-key`) | — | `BankStatementReviewCallbackController.aplicar` | guards: `EngineCallbackKeyGuard` · fuera del contrato OpenAPI |
| `POST` | `/internal/credit/manual-review-callback` | **sin sesión** (`@Public`) | — | `CreditReviewCallbackController.aplicar` | fuera del contrato OpenAPI |
| `GET` | `/merchant/partners/:partnerId/credit-applications` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `MerchantCreditController.list` | guards: `TenantGuard` |
| `POST` | `/merchant/partners/:partnerId/credit-applications/:applicationId/acceptance` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `MerchantCreditController.decide` | guards: `TenantGuard` |
| `GET` | `/operations/credit/applications/:applicationId` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditOperationsController.getApplicationDetail` | guards: `TenantGuard` |
| `POST` | `/operations/credit/applications/:applicationId/business-acceptance` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditOperationsController.decideBusinessAcceptance` | guards: `TenantGuard` |
| `POST` | `/operations/credit/applications/:applicationId/decision` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditOperationsController.decideApplication` | guards: `TenantGuard` |
| `POST` | `/operations/credit/customers/:customerId/credit-line/recalculate` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditOperationsController.recalculateCreditLine` | guards: `TenantGuard` |
| `GET` | `/operations/credit/products` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditOperationsController.listProducts` | guards: `TenantGuard` |
| `POST` | `/operations/credit/products` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditOperationsController.createProduct` | guards: `TenantGuard` |
| `PATCH` | `/operations/credit/products/:productId/status` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CreditOperationsController.changeProductStatus` | guards: `TenantGuard` |
| `GET` | `/operations/customers/:customerId/card-tier` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CardTierOperationsController.get` | guards: `TenantGuard` |
| `POST` | `/operations/customers/:customerId/card-tier` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CardTierOperationsController.set` | guards: `TenantGuard` |
| `POST` | `/operations/customers/:customerId/card-tier/revoke` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CardTierOperationsController.revoke` | guards: `TenantGuard` |

## `credit-rating`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/customers/:customerId/credit-rating` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CreditRatingController.getMyRating` | guards: `TenantGuard` |
| `POST` | `/operations/credit-rating/customers/:customerId/rate` | `risk_analyst`, `internal_operator`, `admin`, `platform_admin` | — | `CreditRatingOperationsController.rateCustomer` | guards: `TenantGuard` |
| `POST` | `/operations/credit-rating/loans/:loanId/rate` | `risk_analyst`, `internal_operator`, `admin`, `platform_admin` | — | `CreditRatingOperationsController.rateLoan` | guards: `TenantGuard` |
| `GET` | `/operations/credit-rating/portfolio-summary` | `risk_analyst`, `internal_operator`, `compliance_analyst`, `admin`, `platform_admin` | — | `CreditRatingOperationsController.getPortfolioSummary` | guards: `TenantGuard` |
| `POST` | `/operations/credit-rating/sweep` | `risk_analyst`, `internal_operator`, `admin`, `platform_admin` | — | `CreditRatingOperationsController.sweep` | guards: `TenantGuard` |
| `GET` | `/operations/customers/:customerId/credit-rating` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CreditRatingController.getCustomerRating` | guards: `TenantGuard` |
| `GET` | `/operations/customers/:customerId/credit-rating-history` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CreditRatingController.getCustomerRatingHistory` | guards: `TenantGuard` |
| `GET` | `/operations/loans/:loanId/rating` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CreditRatingController.getLoanRating` | guards: `TenantGuard` |
| `GET` | `/operations/loans/:loanId/rating-history` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CreditRatingController.getLoanRatingHistory` | guards: `TenantGuard` |
| `GET` | `/operations/rating-scale` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CreditRatingController.getRatingScale` | guards: `TenantGuard` |

## `customer-device-signals`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `DELETE` | `/customers/:customerId/address-book` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerDeviceSignalsController.purgeAddressBook` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/address-book` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerDeviceSignalsController.syncAddressBook` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/location-pings` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerDeviceSignalsController.ingestLocationPings` | guards: `TenantGuard` |

## `customer-onboarding`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/customer-onboarding/:customerId/address-package` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerPackagesController.submitAddressPackage` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/:customerId/answers` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingAnswersController.getAnswers` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/:customerId/consumer-survey` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `ConsumerSurveyController.status` | guards: `TenantGuard` |
| `PUT` | `/customer-onboarding/:customerId/consumer-survey` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `ConsumerSurveyController.save` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/contact-methods` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingProfileController.addContactMethod` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/contact-verification/request` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingController.requestContactVerification` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/contact-verification/submit` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingController.submitContactVerification` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/contacts-snapshot` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerPackagesController.submitContactsSnapshot` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/documents/upload-url` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingProfileController.createUploadUrl` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/:customerId/evidence-documents` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerEvidenceViewController.list` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/:customerId/evidence-documents/:documentId/content` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerEvidenceViewController.content` | guards: `TenantGuard` |
| `PUT` | `/customer-onboarding/:customerId/financial-profile` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingProfileController.upsertFinancialProfile` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/identity-manual-review` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingController.applyIdentityManualReview` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/identity-package` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerPackagesController.submitIdentityPackage` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/identity-verification` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingProfileController.verifyIdentity` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/:customerId/observations` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingStatusController.listObservations` | guards: `TenantGuard` |
| `PATCH` | `/customer-onboarding/:customerId/profile` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingProfileController.updateProfile` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/:customerId/reference-contacts` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingProfileController.listReferences` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/reference-contacts` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingProfileController.addReferences` | guards: `TenantGuard` |
| `DELETE` | `/customer-onboarding/:customerId/reference-contacts/:referenceId` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingProfileController.removeReference` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/:customerId/status` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingStatusController.getStatus` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/submit` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerOnboardingStatusController.submitForReview` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/:customerId/supporting-evidence` | `customer` | — | `CustomerSupportingEvidenceController.registerSupportingEvidence` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/consumer-survey/catalog` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `ConsumerSurveyController.catalog` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/identity-verifications/:attemptId/evidence-documents` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerEvidenceViewController.byAttempt` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/jobs/mark-abandoned` | `admin`, `platform_admin`, `system` | — | `CustomerOnboardingStatusController.markAbandoned` | guards: `TenantGuard` |
| `POST` | `/customer-onboarding/start` | **sin sesión** (`@Public`) | — | `CustomerOnboardingController.startOnboarding` | guards: `TenantGuard` |
| `GET` | `/customer-onboarding/verification-channels` | **sin sesión** (`@Public`) | — | `CustomerOnboardingController.verificationChannels` | guards: `TenantGuard` |
| `POST` | `/internal/identity/manual-review-callback` | **sin sesión** (`@Public`) | — | `IdentityReviewCallbackController.aplicar` | fuera del contrato OpenAPI |
| `POST` | `/operations/customers/:customerId/compliance/clear-matches` | `compliance_analyst`, `admin`, `platform_admin` | — | `CustomerVerificationController.clearMatches` | guards: `TenantGuard` |
| `POST` | `/operations/customers/:customerId/compliance/screening` | `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `CustomerVerificationController.screen` | guards: `TenantGuard` |
| `POST` | `/operations/customers/:customerId/identity-verification/decision` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CustomerVerificationController.decideIdentity` | guards: `TenantGuard` |
| `GET` | `/operations/customers/:customerId/review-dossier` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `OnboardingReviewDossierController.get` | guards: `TenantGuard` |

## `customer-privacy`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/customers/:customerId/privacy/consent-decisions` | `customer`, `internal_operator`, `compliance_analyst`, `admin`, `platform_admin` | — | `CustomerPrivacyController.registerConsentDecisions` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/privacy/data-subject-requests` | `customer`, `internal_operator`, `compliance_analyst`, `admin`, `platform_admin` | — | `CustomerPrivacyController.createDataSubjectRequest` | guards: `TenantGuard` |
| `GET` | `/operations/privacy/data-subject-requests` | `compliance_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `privacy.requests.read` | `OperationsPrivacyRequestsController.list` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/operations/privacy/data-subject-requests/:requestId` | `compliance_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `privacy.requests.read` | `OperationsPrivacyRequestsController.detail` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/privacy/data-subject-requests/:requestId/transition` | `compliance_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `privacy.requests.manage` | `OperationsPrivacyRequestsController.transition` | guards: `TenantGuard`, `InternalPermissionsGuard` |

## `customer-telemetry`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/customers/:customerId/telemetry/batch` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `CustomerTelemetryController.ingestBatch` | guards: `TenantGuard` |

## `customers`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/customers/:customerId/eligibility` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `CustomerEligibilityController.getEligibility` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/customers/:customerId/me` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `CustomersController.getCustomerMe` | guards: `TenantGuard` |
| `GET` | `/internal/contexts/customers/recipient-directory/addresses` | identidad de servicio `{"scope":"customers:recipient-directory","audienceContext":"customers","allowedServices":["messaging-worker"]}` | — | `CustomerRecipientDirectoryController.addresses` | guards: `ServiceTokenGuard` |
| `GET` | `/internal/contexts/customers/recipient-directory/resolve` | identidad de servicio `{"scope":"customers:recipient-directory","audienceContext":"customers","allowedServices":["messaging-worker"]}` | — | `CustomerRecipientDirectoryController.resolve` | guards: `ServiceTokenGuard` |
| `POST` | `/operations/customers/:customerId/eligibility/decision` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | `customers.eligibility.decide` | `CustomerEligibilityController.decideEligibility` | guards: `TenantGuard`, `InternalPermissionsGuard` |

## `data-notebook`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/data-notebook/datasets` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.listDatasets` | — |
| `GET` | `/data-notebook/datasets/:code/rows` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.readRows` | — |
| `GET` | `/data-notebook/datasets/:code/schema` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.describeDataset` | — |
| `GET` | `/data-notebook/history` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.listHistory` | — |
| `POST` | `/data-notebook/history` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.recordHistory` | — |
| `GET` | `/data-notebook/notebooks` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.listNotebooks` | — |
| `POST` | `/data-notebook/notebooks` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.createNotebook` | — |
| `DELETE` | `/data-notebook/notebooks/:id` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.deleteNotebook` | — |
| `GET` | `/data-notebook/notebooks/:id` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.readNotebook` | — |
| `PUT` | `/data-notebook/notebooks/:id` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `DataNotebookController.updateNotebook` | — |

## `data-quality`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/operations/data-quality/issues` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `admin`, `platform_admin` | `dataQuality.issues.read` | `DataQualityController.listIssues` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/data-quality/issues/:issueId/resolve` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | `dataQuality.issues.resolve` | `DataQualityController.resolveIssue` | guards: `TenantGuard`, `InternalPermissionsGuard` |

## `decision-engine`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/internal/decision-artifacts` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `DecisionArtifactBindingController.list` | guards: `TenantGuard` |
| `POST` | `/internal/decision-artifacts` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `DecisionArtifactBindingController.assign` | guards: `TenantGuard` |

## `erp-integration`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/internal/integration/erp/events` | evento firmado por `atlas-erp` (HMAC) | — | `ErpEventsController.receive` | guards: `SignedEventGuard` · fuera del contrato OpenAPI |

## `events`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/operations/events` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `EventsController.listEvents` | guards: `TenantGuard` |
| `POST` | `/operations/events` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `EventsController.createEvent` | guards: `TenantGuard` |
| `GET` | `/operations/events/:eventId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `EventsController.getEvent` | guards: `TenantGuard` |
| `POST` | `/operations/events/:eventId/cancel` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `EventsController.cancelEvent` | guards: `TenantGuard` |
| `POST` | `/operations/events/:eventId/retry` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `EventsController.retryEvent` | guards: `TenantGuard` |
| `GET` | `/operations/events/catalog` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `EventsController.listCatalog` | guards: `TenantGuard` |

## `expedientes`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/expedientes` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesController.listar` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/:id` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesController.obtener` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/:id/actividad` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesController.actividad` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `POST` | `/expedientes/:id/carpetas` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.crearCarpeta` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/:id/contactos` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesContactosController.obtenerContactos` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/:id/nodos` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.listar` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `DELETE` | `/expedientes/:id/nodos/:nodoId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.borrar` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `PATCH` | `/expedientes/:id/nodos/:nodoId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.actualizar` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/:id/nodos/:nodoId/concesiones` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesConcesionesController.listarConcesiones` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `POST` | `/expedientes/:id/nodos/:nodoId/concesiones` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesConcesionesController.conceder` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `DELETE` | `/expedientes/:id/nodos/:nodoId/concesiones/:grantId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesConcesionesController.revocar` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/:id/nodos/:nodoId/concesiones/visibilidad` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesConcesionesController.listarVisibilidad` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/:id/nodos/:nodoId/contenido` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.obtenerContenido` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `POST` | `/expedientes/:id/nodos/:nodoId/restaurar` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.restaurar` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `DELETE` | `/expedientes/:id/papelera` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.purgar` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `POST` | `/expedientes/:id/subidas` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.crearSubida` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `POST` | `/expedientes/:id/subidas/:ticketId/confirmar` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesNodosController.confirmarSubida` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/por-momento` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesController.porMomento` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |
| `GET` | `/expedientes/por-sujeto/:subjectType/:subjectId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `ExpedientesController.porSujeto` | guards: `TenantGuard`, `ExpedienteAccesoGuard` |

## `external-data`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/admin/external-providers` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.listProviders` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/:providerCode/auth-state` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `ProviderAuthAdminController.authState` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/:providerCode/cost-policy` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.getCostPolicy` | guards: `TenantGuard` |
| `PATCH` | `/admin/external-providers/:providerCode/cost-policy/:queryType` | `admin`, `platform_admin` | — | `AdminExternalProvidersController.updateCostPolicy` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/:providerCode/credentials/invalidate-token` | `admin`, `platform_admin` | — | `ProviderAuthAdminController.invalidateToken` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/:providerCode/credentials/revoke` | `admin`, `platform_admin` | — | `ProviderAuthAdminController.revoke` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/:providerCode/credentials/rotate` | `admin`, `platform_admin` | — | `ProviderAuthAdminController.rotate` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/:providerCode/kill-switch` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.killSwitch` | guards: `TenantGuard` |
| `PATCH` | `/admin/external-providers/:providerCode/runtime` | `admin`, `platform_admin` | — | `AdminExternalProvidersController.patchRuntime` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/:providerCode/test` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.testProvider` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/auth-broker/availability` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `ProviderAuthAdminController.availability` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/auth-state` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `ProviderAuthAdminController.listAuthStates` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/credentials/pending-rotation` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `ProviderAuthAdminController.pendingRotation` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/dashboard` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `ExternalProvidersDashboardController.dashboard` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/health` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.health` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/idempotency-audit` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.idempotencyAudit` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/policy/preview` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.previewPolicy` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/production-gate` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.productionGate` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/quality-audit` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.qualityAudit` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/readiness` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.readiness` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/requests` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `ExternalProvidersDashboardController.requests` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/requests/:requestId/approve` | `admin`, `platform_admin` | — | `AdminExternalProvidersController.approveRequest` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/requests/:requestId/rebuild-features` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.rebuildFeatures` | guards: `TenantGuard` |
| `POST` | `/admin/external-providers/requests/:requestId/retry` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.retryRequest` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/retention/preview` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.retentionPreview` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/sanitization-audit` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.sanitizationAudit` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/sla` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.sla` | guards: `TenantGuard` |
| `GET` | `/admin/external-providers/usage` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `AdminExternalProvidersController.usage` | guards: `TenantGuard` |
| `POST` | `/bureau/infocenter/check` | `admin`, `platform_admin`, `risk_analyst`, `compliance_analyst` | — | `BureauExternalDataController.checkInfocenter` | guards: `TenantGuard` |
| `POST` | `/digital-trust/check` | `customer`, `internal_operator`, `risk_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `DigitalTrustExternalDataController.check` | guards: `TenantGuard` |
| `GET` | `/digital-trust/profile/:customerId` | `customer`, `internal_operator`, `risk_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `DigitalTrustExternalDataController.profile` | guards: `TenantGuard` |
| `POST` | `/external-data/consents` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.createConsent` | guards: `TenantGuard` |
| `POST` | `/external-data/consents/:consentId/revoke` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.revokeConsent` | guards: `TenantGuard` |
| `GET` | `/external-data/consents/user/:customerId` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.listConsents` | guards: `TenantGuard` |
| `GET` | `/external-data/providers/health` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.getProviderHealth` | guards: `TenantGuard` |
| `POST` | `/external-data/requests` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.executeRequest` | guards: `TenantGuard` |
| `GET` | `/external-data/requests/:requestId` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.getRequest` | guards: `TenantGuard` |
| `POST` | `/external-data/requests/preview` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.previewRequest` | guards: `TenantGuard` |
| `GET` | `/external-data/users/:customerId/decision-package` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.getDecisionPackage` | guards: `TenantGuard` |
| `GET` | `/external-data/users/:customerId/features` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.getUserFeatures` | guards: `TenantGuard` |
| `GET` | `/external-data/users/:customerId/observations` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.getUserObservations` | guards: `TenantGuard` |
| `GET` | `/external-data/users/:customerId/scoring-input` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `ExternalDataController.getUserScoringInput` | guards: `TenantGuard` |
| `POST` | `/kyc/segip/verify` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `KycExternalDataController.verifySegip` | guards: `TenantGuard` |
| `POST` | `/payments/bank-transfer/qr` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `PaymentsExternalDataController.generateBankQr` | guards: `TenantGuard` |
| `POST` | `/payments/bank-transfer/verify` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `PaymentsExternalDataController.verifyBankTransfer` | guards: `TenantGuard` |
| `POST` | `/payments/qr/verify` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `PaymentsExternalDataController.verifyQr` | guards: `TenantGuard` |
| `POST` | `/social/facebook/callback` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `FacebookExternalDataController.callback` | guards: `TenantGuard` |
| `GET` | `/social/facebook/connect-url` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `FacebookExternalDataController.getConnectUrl` | guards: `TenantGuard` |
| `GET` | `/social/facebook/status/:customerId` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `FacebookExternalDataController.status` | guards: `TenantGuard` |
| `GET` | `/telco/phone-trust/:customerId` | `customer`, `internal_operator`, `risk_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `TelcoExternalDataController.getPhoneTrust` | guards: `TenantGuard` |
| `POST` | `/telco/phone-trust/verify` | `customer`, `internal_operator`, `risk_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `TelcoExternalDataController.verifyPhoneTrust` | guards: `TenantGuard` |
| `GET` | `/whatsapp/status/:customerId` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `WhatsappExternalDataController.status` | guards: `TenantGuard` |
| `POST` | `/whatsapp/verification/confirm` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `WhatsappExternalDataController.confirm` | guards: `TenantGuard` |
| `POST` | `/whatsapp/verification/start` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system` | — | `WhatsappExternalDataController.start` | guards: `TenantGuard` |

## `health`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/health` | **sin sesión** (`@Public`) | — | `HealthController.check` | — |
| `GET` | `/health/liveness` | **sin sesión** (`@Public`) | — | `HealthController.liveness` | — |
| `GET` | `/health/readiness` | **sin sesión** (`@Public`) | — | `HealthController.readiness` | — |

## `internal-portal`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/internal/alerts` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.listAlerts` | guards: `TenantGuard` |
| `POST` | `/internal/alerts/:alertId/acknowledge` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.acknowledgeAlert` | guards: `TenantGuard` |
| `GET` | `/internal/business-metadata/glossary` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalMetadataController.listBusinessTerms` | guards: `TenantGuard` |
| `GET` | `/internal/business-metadata/glossary/facets` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalMetadataController.listBusinessTermFacets` | guards: `TenantGuard` |
| `GET` | `/internal/business-metadata/terms/:termId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalMetadataController.getBusinessTerm` | guards: `TenantGuard` |
| `GET` | `/internal/data-quality/rules` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.listDataQualityRules` | guards: `TenantGuard` |
| `GET` | `/internal/data-quality/rules/:ruleId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.getDataQualityRule` | guards: `TenantGuard` |
| `GET` | `/internal/exports` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.listExports` | guards: `TenantGuard` |
| `GET` | `/internal/exports/:exportId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.getExport` | guards: `TenantGuard` |
| `GET` | `/internal/governance/policies/:policyId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.getGovernancePolicy` | guards: `TenantGuard` |
| `GET` | `/internal/jobs` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.listJobs` | guards: `TenantGuard` |
| `GET` | `/internal/jobs/:jobRunId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.getJob` | guards: `TenantGuard` |
| `GET` | `/internal/lineage` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalMetadataController.getLineage` | guards: `TenantGuard` |
| `GET` | `/internal/lineage/impact` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalMetadataController.getLineageImpact` | guards: `TenantGuard` |
| `GET` | `/internal/lineage/nodes/:nodeId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalMetadataController.getLineageNode` | guards: `TenantGuard` |
| `GET` | `/internal/release-readiness` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.getReleaseReadiness` | guards: `TenantGuard` |
| `GET` | `/internal/reports` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.listReports` | guards: `TenantGuard` |
| `GET` | `/internal/reports/:reportId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.getReport` | guards: `TenantGuard` |
| `POST` | `/internal/reports/:reportId/run` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.runReport` | guards: `TenantGuard` |
| `GET` | `/internal/search` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `InternalPortalController.search` | guards: `TenantGuard` |
| `GET` | `/internal/views/:view/facets` | `internal_operator`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `AdminReadController.listFacets` | guards: `TenantGuard` |
| `GET` | `/internal/views/audit-events` | `internal_operator`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `AdminReadController.listAuditEvents` | guards: `TenantGuard` |
| `GET` | `/internal/views/customers` | `internal_operator`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `AdminReadController.listCustomers` | guards: `TenantGuard` |
| `GET` | `/internal/views/endpoint-coverage` | `internal_operator`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `AdminReadController.listEndpointCoverage` | guards: `TenantGuard` |
| `GET` | `/internal/views/notification-deliveries` | `internal_operator`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `AdminReadController.listNotificationDeliveries` | guards: `TenantGuard` |
| `GET` | `/internal/views/provider-health` | `internal_operator`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `AdminReadController.listProviderHealth` | guards: `TenantGuard` |
| `GET` | `/internal/views/risk-assessments` | `internal_operator`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `AdminReadController.listRiskAssessments` | guards: `TenantGuard` |
| `GET` | `/internal/views/work-queue` | `internal_operator`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor` | — | `AdminReadController.listWorkQueue` | guards: `TenantGuard` |

## `internal-users`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/internal/auth/login` | **sin sesión** (`@Public`) | — | `InternalAuthController.login` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/internal/auth/login/pin` | **sin sesión** (`@Public`) | — | `InternalAuthController.verifyLoginPin` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/internal/auth/logout` | **sin sesión** (`@Public`) | — | `InternalAuthController.logout` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/internal/auth/me` | cualquier sesión autenticada | — | `InternalAuthController.me` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/internal/auth/refresh` | **sin sesión** (`@Public`) | — | `InternalAuthController.refresh` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/internal/auth/signup` | cualquier sesión autenticada | `internal.users.manage`, `internal.roles.manage` | `InternalAuthController.signup` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/internal/permissions` | cualquier sesión autenticada | `internal.permissions.read` | `InternalAccessCatalogController.listPermissions` | guards: `InternalPermissionsGuard` |
| `GET` | `/internal/roles` | cualquier sesión autenticada | `internal.roles.read` | `InternalAccessCatalogController.listRoles` | guards: `InternalPermissionsGuard` |
| `GET` | `/internal/roles/:roleId` | cualquier sesión autenticada | `internal.roles.read` | `InternalAccessCatalogController.getRole` | guards: `InternalPermissionsGuard` |
| `GET` | `/internal/users` | cualquier sesión autenticada | `internal.users.read` | `InternalUsersController.list` | guards: `InternalPermissionsGuard` |
| `GET` | `/internal/users/:internalUserId` | cualquier sesión autenticada | `internal.users.read` | `InternalUsersController.get` | guards: `InternalPermissionsGuard` |
| `PATCH` | `/internal/users/:internalUserId` | cualquier sesión autenticada | `internal.users.manage` | `InternalUsersController.update` | guards: `InternalPermissionsGuard` |
| `PATCH` | `/internal/users/:internalUserId/roles` | cualquier sesión autenticada | `internal.users.manage`, `internal.roles.manage` | `InternalUsersController.replaceRoles` | guards: `InternalPermissionsGuard` |
| `POST` | `/internal/users/:internalUserId/unlock` | cualquier sesión autenticada | `internal.users.manage` | `InternalUsersController.unlock` | guards: `InternalPermissionsGuard` |

## `loan-payment-claims`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/merchant/partners/:partnerId/payment-claims` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantPaymentClaimsController.list` | guards: `TenantGuard` |
| `GET` | `/merchant/partners/:partnerId/payment-claims/:claimId/proof` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantPaymentClaimsController.proof` | guards: `TenantGuard` |
| `POST` | `/merchant/partners/:partnerId/payment-claims/:claimId/verification` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantPaymentClaimsController.decide` | guards: `TenantGuard` |
| `GET` | `/merchant/partners/:partnerId/payment-claims/portfolio` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantPaymentClaimsController.portfolio` | guards: `TenantGuard` |
| `POST` | `/mobile/customers/:customerId/payment-claims` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobilePaymentClaimsController.submit` | guards: `TenantGuard` |
| `GET` | `/mobile/customers/:customerId/payment-claims/instructions/:installmentId` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobilePaymentClaimsController.instruction` | guards: `TenantGuard` |
| `POST` | `/mobile/customers/:customerId/payment-claims/proof-tickets` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobilePaymentClaimsController.createTicket` | guards: `TenantGuard` |
| `GET` | `/operations/payment-claims` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `OperationsPaymentClaimsController.list` | guards: `TenantGuard` |

## `loans`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/credit-applications/:applicationId/disbursement` | `internal_operator`, `admin`, `platform_admin` | — | `LoansController.disburse` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/loans` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `LoansController.listByCustomer` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/payment-calendar` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `LoansController.paymentCalendar` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/spending-by-category` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `LoansController.spendingByCategory` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/spending-report.pdf` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `LoansController.spendingReport` | guards: `TenantGuard` |
| `GET` | `/loans/:loanId` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `LoansController.detail` | guards: `TenantGuard` |
| `POST` | `/loans/:loanId/payments` | `internal_operator`, `admin`, `platform_admin` | — | `LoanPaymentsController.registerPayment` | guards: `TenantGuard` |
| `POST` | `/loans/:loanId/payments/:paymentId/reversal` | `internal_operator`, `admin`, `platform_admin` | — | `LoanPaymentsController.reversePayment` | guards: `TenantGuard` |
| `POST` | `/loans/:loanId/write-off` | `admin`, `platform_admin` | — | `LoanPaymentsController.writeOffLoan` | guards: `TenantGuard` |
| `GET` | `/operations/loans` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `LoansOperationsController.list` | guards: `TenantGuard` |
| `POST` | `/operations/loans/delinquency-sweep` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `LoansOperationsController.sweep` | guards: `TenantGuard` |
| `GET` | `/operations/loans/outcome-backlog` | `risk_analyst`, `admin`, `platform_admin` | — | `LoansOperationsController.backlog` | guards: `TenantGuard` |
| `GET` | `/operations/loans/outcome-status` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `LoansOperationsController.outcomeStatus` | guards: `TenantGuard` |
| `GET` | `/policies/delinquency` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `LoansController.delinquencyPolicy` | guards: `TenantGuard` |

## `log-sync`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/systems/logs/mongo` | `internal_operator`, `admin`, `platform_admin`, `readonly_auditor` | — | `MongoLogsController.listMongoLogs` | — |

## `merchant-identity`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/merchant/auth/login` | **sin sesión** (`@Public`) | — | `MerchantAuthController.login` | — |
| `POST` | `/merchant/auth/logout` | **sin sesión** (`@Public`) | — | `MerchantAuthController.logout` | — |
| `GET` | `/merchant/auth/me` | cualquier sesión autenticada | — | `MerchantAuthController.me` | — |
| `POST` | `/merchant/auth/refresh` | **sin sesión** (`@Public`) | — | `MerchantAuthController.refresh` | — |
| `GET` | `/merchant/users` | cualquier sesión autenticada | `merchant.users.read` | `MerchantUsersController.list` | guards: `InternalPermissionsGuard` |
| `GET` | `/merchant/users/:merchantUserId` | cualquier sesión autenticada | `merchant.users.read` | `MerchantUsersController.get` | guards: `InternalPermissionsGuard` |
| `PATCH` | `/merchant/users/:merchantUserId/status` | cualquier sesión autenticada | `merchant.users.manage` | `MerchantUsersController.updateStatus` | guards: `InternalPermissionsGuard` |
| `GET` | `/merchant/users/provisioning-requests` | cualquier sesión autenticada | `merchant.users.read` | `MerchantUsersController.listRequests` | guards: `InternalPermissionsGuard` |
| `POST` | `/merchant/users/provisioning-requests` | cualquier sesión autenticada | `merchant.users.request` | `MerchantUsersController.enqueueRequest` | guards: `InternalPermissionsGuard` |
| `GET` | `/merchant/users/provisioning-requests/:requestId` | cualquier sesión autenticada | `merchant.users.read` | `MerchantUsersController.getRequest` | guards: `InternalPermissionsGuard` |
| `POST` | `/merchant/users/provisioning-requests/:requestId/approve` | cualquier sesión autenticada | `merchant.users.manage` | `MerchantUsersController.approveRequest` | guards: `InternalPermissionsGuard` |
| `POST` | `/merchant/users/provisioning-requests/:requestId/reject` | cualquier sesión autenticada | `merchant.users.manage` | `MerchantUsersController.rejectRequest` | guards: `InternalPermissionsGuard` |

## `mobile-identity`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/mobile/identity-verifications` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `MobileIdentityController.start` | guards: `TenantGuard` |
| `GET` | `/mobile/identity-verifications/:verificationId` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `MobileIdentityController.get` | guards: `TenantGuard` |

## `mobile-welcome-audio`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/mobile/welcome-audio` | `customer` | — | `MobileWelcomeAudioController.start` | guards: `TenantGuard` |
| `GET` | `/mobile/welcome-audio/:requestId` | `customer` | — | `MobileWelcomeAudioController.get` | guards: `TenantGuard` |
| `GET` | `/mobile/welcome-audio/:requestId/audio` | `customer` | — | `MobileWelcomeAudioController.audio` | guards: `TenantGuard` |

## `notifications`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/customers/:customerId/device-tokens` | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` | — | `NotificationsController.upsertDeviceToken` | guards: `TenantGuard` |
| `DELETE` | `/customers/:customerId/device-tokens/:deviceTokenId` | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` | — | `NotificationsController.deactivateDeviceToken` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/notification-preferences` | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` | — | `CustomerNotificationsController.getOwnPreferences` | guards: `TenantGuard` |
| `PATCH` | `/customers/:customerId/notification-preferences` | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` | — | `CustomerNotificationsController.updateOwnPreferences` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/notifications` | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` | — | `CustomerNotificationsController.listCustomerNotifications` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/notifications/:notificationId/read` | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` | — | `CustomerNotificationsController.markRead` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/notifications/read-all` | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` | — | `NotificationsController.markAllRead` | guards: `TenantGuard` |
| `GET` | `/customers/:customerId/notifications/unread-count` | `customer`, `internal_operator`, `admin`, `platform_admin`, `system` | — | `CustomerNotificationsController.unreadCount` | guards: `TenantGuard` |
| `GET` | `/internal-users/me/notifications` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system` | — | `NotificationsController.listMyNotifications` | guards: `TenantGuard` |
| `POST` | `/internal-users/me/notifications/:notificationId/read` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system` | — | `NotificationsController.markMyNotificationRead` | guards: `TenantGuard` |
| `POST` | `/internal-users/me/notifications/read-all` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system` | — | `NotificationsController.markAllMyNotificationsRead` | guards: `TenantGuard` |
| `GET` | `/internal-users/me/notifications/unread-count` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system` | — | `NotificationsController.myUnreadNotificationsCount` | guards: `TenantGuard` |
| `POST` | `/internal/integration/erp/mail` | **sin sesión** (`@Public`) | — | `ErpMailController.send` | guards: `ErpMailSignatureGuard` · fuera del contrato OpenAPI |
| `POST` | `/internal/notifications/brevo-sms-events/:secreto` | **sin sesión** (`@Public`) | — | `NotificationProviderCallbacksController.brevoSmsEvents` | fuera del contrato OpenAPI |
| `POST` | `/internal/notifications/sendgrid-events` | **sin sesión** (`@Public`) | — | `NotificationProviderCallbacksController.sendGridEvents` | fuera del contrato OpenAPI |
| `POST` | `/internal/notifications/twilio-status` | **sin sesión** (`@Public`) | — | `NotificationProviderCallbacksController.twilioStatus` | fuera del contrato OpenAPI |
| `GET` | `/operations/notification-policies` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `admin`, `platform_admin` | — | `NotificationPoliciesOperationsController.list` | guards: `TenantGuard` |
| `PUT` | `/operations/notification-policies` | `admin`, `platform_admin` | — | `NotificationPoliciesOperationsController.upsert` | guards: `TenantGuard` |
| `GET` | `/operations/notifications/audience-segments` | `internal_operator`, `admin`, `platform_admin`, `system` | — | `NotificationAudienceSegmentsController.list` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/audience-segments` | `admin`, `platform_admin` | — | `NotificationAudienceSegmentsController.create` | guards: `TenantGuard` |
| `PATCH` | `/operations/notifications/audience-segments/:segmentId` | `admin`, `platform_admin` | — | `NotificationAudienceSegmentsController.update` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/broadcast` | `admin`, `platform_admin`, `system` | — | `NotificationBroadcastController.broadcastNotification` | guards: `TenantGuard` |
| `GET` | `/operations/notifications/campaigns` | `internal_operator`, `admin`, `platform_admin`, `system` | — | `NotificationCampaignsController.list` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns` | `admin`, `platform_admin` | — | `NotificationCampaignsController.create` | guards: `TenantGuard` |
| `GET` | `/operations/notifications/campaigns/:campaignId` | `internal_operator`, `admin`, `platform_admin`, `system` | — | `NotificationCampaignsController.get` | guards: `TenantGuard` |
| `PATCH` | `/operations/notifications/campaigns/:campaignId` | `admin`, `platform_admin` | — | `NotificationCampaignsController.update` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns/:campaignId/cancel` | `admin`, `platform_admin` | — | `NotificationCampaignsController.cancel` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns/:campaignId/duplicate` | `admin`, `platform_admin` | — | `NotificationCampaignsController.duplicate` | guards: `TenantGuard` |
| `GET` | `/operations/notifications/campaigns/:campaignId/messages` | `internal_operator`, `admin`, `platform_admin`, `system` | — | `NotificationCampaignsController.messages` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns/:campaignId/pause` | `admin`, `platform_admin` | — | `NotificationCampaignsController.pause` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns/:campaignId/resume` | `admin`, `platform_admin` | — | `NotificationCampaignsController.resume` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns/:campaignId/schedule` | `admin`, `platform_admin` | — | `NotificationCampaignsController.schedule` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns/:campaignId/test-send` | `admin`, `platform_admin` | — | `NotificationCampaignsController.sendTest` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns/:campaignId/unschedule` | `admin`, `platform_admin` | — | `NotificationCampaignsController.unschedule` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/campaigns/audience/estimate` | `internal_operator`, `admin`, `platform_admin`, `system` | — | `NotificationCampaignsController.estimate` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/internal-mail` | `internal_operator`, `admin`, `platform_admin`, `system_admin`, `system` | — | `InternalMailController.send` | — |
| `GET` | `/operations/notifications/messages` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `readonly_auditor`, `admin`, `platform_admin`, `system` | — | `NotificationsController.listMessages` | guards: `TenantGuard` |
| `GET` | `/operations/notifications/messages/:messageId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `readonly_auditor`, `admin`, `platform_admin`, `system` | — | `NotificationsController.getMessage` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/messages/:messageId/cancel` | `admin`, `platform_admin`, `system`, `internal_operator` | — | `NotificationsController.cancelMessage` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/messages/:messageId/retry` | `admin`, `platform_admin`, `system`, `internal_operator` | — | `NotificationsController.retryMessage` | guards: `TenantGuard` |
| `GET` | `/operations/notifications/preferences/:customerId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `readonly_auditor`, `admin`, `platform_admin`, `system` | — | `NotificationTemplatesController.getPreferences` | guards: `TenantGuard` |
| `PATCH` | `/operations/notifications/preferences/:customerId` | `admin`, `platform_admin`, `system`, `internal_operator` | — | `NotificationTemplatesController.updatePreferences` | guards: `TenantGuard` |
| `GET` | `/operations/notifications/templates` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `readonly_auditor`, `admin`, `platform_admin`, `system` | — | `NotificationTemplatesController.listTemplates` | guards: `TenantGuard` |
| `POST` | `/operations/notifications/templates` | `admin`, `platform_admin`, `system` | — | `NotificationTemplatesController.createTemplate` | guards: `TenantGuard` |
| `PATCH` | `/operations/notifications/templates/:templateId` | `admin`, `platform_admin`, `system` | — | `NotificationTemplatesController.updateTemplate` | guards: `TenantGuard` |

## `operations`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/operations/customers/:customerId/behavior-summary` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `OperationsController.getBehaviorSummary` | guards: `TenantGuard` |
| `GET` | `/operations/customers/:customerId/investigation-summary` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `OperationsController.getInvestigationSummary` | guards: `TenantGuard` |
| `GET` | `/operations/customers/pending-contact-verification` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `OperationsController.listPendingContactVerification` | guards: `TenantGuard` |
| `GET` | `/operations/fraud-cases` | `fraud_analyst`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `OperationsController.getFraudCasesCursorPage` | guards: `TenantGuard` |
| `POST` | `/operations/fraud-cases/:caseId/decision` | `fraud_analyst`, `admin`, `platform_admin` | — | `OperationsController.decideFraudCase` | guards: `TenantGuard` |
| `GET` | `/operations/manual-review-cases` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `OperationsController.getManualReviewCasesCursorPage` | guards: `TenantGuard` |
| `POST` | `/operations/manual-review-cases/:caseId/decision` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `OperationsController.decideManualReviewCase` | guards: `TenantGuard` |
| `GET` | `/operations/work-queue` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `fraud_analyst` | — | `OperationsController.getWorkQueue` | guards: `TenantGuard` |

## `partner-onboarding`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/merchant-qr/payment` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `MerchantQrController.payment` | guards: `TenantGuard` |
| `POST` | `/merchant-qr/resolve` | `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `MerchantQrController.resolve` | guards: `TenantGuard` |
| `GET` | `/operations/erp-documents/content` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `ErpDocumentsController.content` | guards: `TenantGuard` |
| `POST` | `/operations/erp-documents/merchant-expediente` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `ErpDocumentsController.merchantExpedienteDeCuenta` | guards: `TenantGuard` |
| `POST` | `/operations/erp-documents/merchant-expediente/:partnerId/upload-url` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `ErpDocumentsController.merchantExpedienteUploadUrl` | guards: `TenantGuard` |
| `POST` | `/operations/erp-documents/upload-url` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `ErpDocumentsController.uploadUrl` | guards: `TenantGuard` |
| `POST` | `/operations/erp-documents/verify` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `ErpDocumentsController.verify` | guards: `TenantGuard` |
| `GET` | `/operations/partner-contract-templates` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | — | `PartnerContractTemplatesController.list` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/partner-contract-templates` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | `governance.policies.manage` | `PartnerContractTemplatesController.publish` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `PATCH` | `/operations/partner-contract-templates/:templateId/default` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | `governance.policies.manage` | `PartnerContractTemplatesController.setDefault` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/operations/partner-contract-templates/default` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` | `partner.kyb.request` | `PartnerContractTemplatesController.getDefault` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/operations/partners` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOperationsController.find` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/partners/:partnerId/decision` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | `partner.kyb.decide` | `PartnerOperationsController.decide` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `PATCH` | `/operations/partners/:partnerId/erp-account` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | `partner.kyb.request` | `PartnerOperationsController.linkErpAccount` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/partners/:partnerId/kyb-review` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | `partner.kyb.request` | `PartnerOperationsController.requestKybReview` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `POST` | `/operations/partners/:partnerId/qr-codes/:qrId/review` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | `partner.qr.review` | `PartnerOperationsController.reviewQr` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/operations/partners/qr-codes/pending` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOperationsController.listQrPendingReview` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/operations/partners/queue` | `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOperationsController.listQueue` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/partner-onboarding/:partnerId/branches` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.listBranches` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/branches` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.registerBranch` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `PATCH` | `/partner-onboarding/:partnerId/branches/:branchId` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.linkBranch` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/branches/:branchId/pos-terminals` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.registerPos` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `PATCH` | `/partner-onboarding/:partnerId/commercial-profile` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOnboardingController.updateCommercialProfile` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/commercial-registry` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOnboardingController.setCommercialRegistry` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/contact-verification/request` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerContactVerificationController.requestContactVerification` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/contact-verification/submit` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerContactVerificationController.submitContactVerification` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/documents/upload-url` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOnboardingController.documentUploadUrl` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/legal-representative` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOnboardingController.addLegalRepresentative` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `GET` | `/partner-onboarding/:partnerId/pos-terminals` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.listPos` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `PATCH` | `/partner-onboarding/:partnerId/pos-terminals/:terminalId` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.changePosStatus` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `GET` | `/partner-onboarding/:partnerId/qr-codes` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.listQr` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/qr-codes` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.registerQr` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `GET` | `/partner-onboarding/:partnerId/qr-codes/:qrId/content` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.qrContent` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/qr-codes/upload-url` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerCommerceController.createQrUploadUrl` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `GET` | `/partner-onboarding/:partnerId/status` | cualquier sesión autenticada | — | `PartnerOnboardingController.status` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/:partnerId/submit` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOnboardingController.submit` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `GET` | `/partner-onboarding/mine` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOnboardingController.mine` | guards: `TenantGuard`, `PartnerOwnershipGuard` |
| `POST` | `/partner-onboarding/start` | `merchant`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin` | — | `PartnerOnboardingController.start` | guards: `TenantGuard`, `PartnerOwnershipGuard` |

## `qa-orchestration`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/systems/qa/campaigns` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.campaigns` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/capabilities` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.capabilities` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/coverage` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.coverage` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/journey-templates` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.templates` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/journey-templates/:code/versions/:version` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.template` | guards: `InternalPermissionsGuard` |
| `POST` | `/systems/qa/journey-templates/:code/versions/:version/sample-inputs` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.sampleInputs` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/runs` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.runs` | guards: `InternalPermissionsGuard` |
| `POST` | `/systems/qa/runs` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.execute` | `QaRunsController.launch` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/runs/:runId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.run` | guards: `InternalPermissionsGuard` |
| `POST` | `/systems/qa/runs/:runId/cancel` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.execute` | `QaRunsController.cancel` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/runs/:runId/events` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.events` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/runs/:runId/evidence` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.evidence` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/runs/:runId/personas` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.personas` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/runs/:runId/personas/:personaKey/steps` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.steps` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/qa/runs/:runId/timeline` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.read` | `QaRunsController.timeline` | guards: `InternalPermissionsGuard` |
| `POST` | `/systems/qa/runs/preflight` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.qa.execute` | `QaRunsController.preflight` | guards: `InternalPermissionsGuard` |

## `risk`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/customers/:customerId/risk-assessments` | `customer`, `internal_operator`, `risk_analyst`, `system`, `admin`, `platform_admin` | — | `RiskController.createRiskAssessment` | guards: `TenantGuard` |
| `POST` | `/internal/risk/manual-review-callback` | **sin sesión** (`@Public`) | — | `RiskReviewCallbackController.aplicar` | fuera del contrato OpenAPI |
| `GET` | `/operations/risk-assessments/:riskAssessmentRunId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `RiskController.getRiskAssessmentDetail` | guards: `TenantGuard` |
| `GET` | `/operations/risk-assessments/:riskAssessmentRunId/explanation` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `RiskController.getRiskAssessmentExplanation` | guards: `TenantGuard` |

## `runtime-jobs`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `POST` | `/operations/jobs/apply-retention-policies` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.applyRetentionPolicies` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/backfill-expedientes` | `admin`, `platform_admin`, `system` | — | `ExpedientesJobsController.backfillExpedientes` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/deliver-pending-notifications` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.deliverPendingNotifications` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/dispatch-loan-outcomes` | `admin`, `platform_admin`, `system` | — | `RuntimeDecisionJobsController.dispatchLoanOutcomes` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/expire-stale-sessions` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.expireStaleSessions` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/limpiar-expedientes` | `admin`, `platform_admin`, `system` | — | `ExpedientesJobsController.limpiarExpedientes` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/process-events` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.processEvents` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/process-outbox` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.processOutbox` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/purge-idempotency-keys` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.purgeIdempotencyKeys` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/purge-processed-outbox` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.purgeProcessedOutbox` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/recalculate-data-quality` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.recalculateDataQuality` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/reclaim-stuck-events` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.reclaimStuckEvents` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/retry-stuck-notifications` | `admin`, `platform_admin`, `system` | — | `RuntimeJobsController.retryStuckNotifications` | guards: `TenantGuard` |
| `POST` | `/operations/jobs/sweep-debt-ratings` | `admin`, `platform_admin`, `system` | — | `RuntimeDecisionJobsController.sweepDebtRatings` | guards: `TenantGuard` |

## `schema-management`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/operations/schema/change-log` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor` | — | `SchemaManagementController.listChangeLog` | guards: `SchemaChangeAuthorizationGuard` |
| `PATCH` | `/operations/schema/change-log/:changeId/approve` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `qa_engineer` | `governance.schema.approve` | `SchemaManagementController.approveChange` | guards: `SchemaChangeAuthorizationGuard` |
| `GET` | `/operations/schema/tables` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor` | — | `SchemaManagementController.listTables` | guards: `SchemaChangeAuthorizationGuard` |
| `POST` | `/operations/schema/tables` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `fraud_analyst`, `compliance_analyst`, `qa_engineer` | `governance.schema.propose` | `SchemaManagementController.proposeTable` | guards: `SchemaChangeAuthorizationGuard` |
| `GET` | `/operations/schema/tables/:tableId` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor` | — | `SchemaManagementController.getTable` | guards: `SchemaChangeAuthorizationGuard` |
| `GET` | `/operations/schema/versions` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor` | — | `SchemaManagementController.listVersions` | guards: `SchemaChangeAuthorizationGuard` |
| `GET` | `/operations/schema/versions/:versionId` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor` | — | `SchemaManagementController.getVersion` | guards: `SchemaChangeAuthorizationGuard` |
| `GET` | `/operations/schema/versions/:versionId/schemas` | `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor` | — | `SchemaManagementController.listVersionSchemas` | guards: `SchemaChangeAuthorizationGuard` |

## `sessions`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/customers/:customerId/session-state` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CustomerSessionsController.getSessionState` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/sessions/:sessionId/end` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CustomerSessionsController.endSession` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/sessions/:sessionId/heartbeat` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CustomerSessionsController.heartbeat` | guards: `TenantGuard` |
| `POST` | `/customers/:customerId/sessions/start` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `CustomerSessionsController.startSession` | guards: `TenantGuard` |
| `GET` | `/operations/sessions/:sessionId/investigation-summary` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` | — | `OperationsSessionsController.getInvestigationSummary` | guards: `TenantGuard` |

## `sql-console`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/sql-console/catalog` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `SqlConsoleController.catalogo` | — |
| `GET` | `/sql-console/history` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `SqlConsoleController.historial` | — |
| `POST` | `/sql-console/query` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `SqlConsoleController.ejecutar` | — |
| `POST` | `/sql-console/validate` | `system_admin`, `platform_admin`, `admin`, `readonly_auditor`, `risk_analyst`, `compliance_analyst` | — | `SqlConsoleController.validar` | — |

## `src/common/observability`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/metrics` | **sin sesión** (`@Public`) | — | `MetricsController.scrape` | fuera del contrato OpenAPI |

## `support`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/admin/support/knowledge/articles` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.listArticles` | guards: `TenantGuard` |
| `POST` | `/admin/support/knowledge/articles` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.createArticle` | guards: `TenantGuard` |
| `GET` | `/admin/support/knowledge/articles/:articleId` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.getArticle` | guards: `TenantGuard` |
| `POST` | `/admin/support/knowledge/articles/:articleId/versions` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.createVersion` | guards: `TenantGuard` |
| `GET` | `/admin/support/knowledge/versions` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.listVersions` | guards: `TenantGuard` |
| `GET` | `/admin/support/knowledge/versions/:versionId` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.getVersion` | guards: `TenantGuard` |
| `POST` | `/admin/support/knowledge/versions/:versionId/approve` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.approve` | guards: `TenantGuard` |
| `POST` | `/admin/support/knowledge/versions/:versionId/publish` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.publish` | guards: `TenantGuard` |
| `POST` | `/admin/support/knowledge/versions/:versionId/submit-review` | `internal_operator`, `compliance_analyst`, `risk_analyst`, `admin`, `platform_admin` | — | `SupportKnowledgeAdminController.submitReview` | guards: `TenantGuard` |
| `GET` | `/internal/support/cases` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.workQueue` | guards: `TenantGuard` |
| `GET` | `/internal/support/cases/:caseId` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.detail` | guards: `TenantGuard` |
| `POST` | `/internal/support/cases/:caseId/claim` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.claim` | guards: `TenantGuard` |
| `POST` | `/internal/support/cases/:caseId/close` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.close` | guards: `TenantGuard` |
| `POST` | `/internal/support/cases/:caseId/escalate` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.escalate` | guards: `TenantGuard` |
| `POST` | `/internal/support/cases/:caseId/links` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.link` | guards: `TenantGuard` |
| `POST` | `/internal/support/cases/:caseId/notes` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.note` | guards: `TenantGuard` |
| `POST` | `/internal/support/cases/:caseId/resolve` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.resolve` | guards: `TenantGuard` |
| `GET` | `/internal/support/cases/:caseId/timeline` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.timeline` | guards: `TenantGuard` |
| `POST` | `/internal/support/cases/:caseId/transfer` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.transfer` | guards: `TenantGuard` |
| `POST` | `/internal/support/cases/:caseId/triage` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportController.triage` | guards: `TenantGuard` |
| `GET` | `/internal/support/categories` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportCatalogController.categories` | guards: `TenantGuard` |
| `GET` | `/internal/support/codes` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportCatalogController.codes` | guards: `TenantGuard` |
| `GET` | `/internal/support/desk/agents` | `admin`, `platform_admin` | — | `InternalSupportDeskController.agents` | guards: `TenantGuard` |
| `POST` | `/internal/support/desk/agents` | `admin`, `platform_admin` | — | `InternalSupportDeskController.createAgent` | guards: `TenantGuard` |
| `DELETE` | `/internal/support/desk/agents/:agentProfileId` | `admin`, `platform_admin` | — | `InternalSupportDeskController.deactivateAgent` | guards: `TenantGuard` |
| `POST` | `/internal/support/desk/channels/:channelId/claim` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportDeskController.claim` | guards: `TenantGuard` |
| `GET` | `/internal/support/desk/channels/:channelId/integrity` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportDeskController.integrity` | guards: `TenantGuard` |
| `GET` | `/internal/support/desk/mine` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportDeskController.mine` | guards: `TenantGuard` |
| `POST` | `/internal/support/desk/presence` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportDeskController.presence` | guards: `TenantGuard` |
| `GET` | `/internal/support/desk/queue` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportDeskController.queue` | guards: `TenantGuard` |
| `POST` | `/internal/support/desk/sla/sweep` | `admin`, `platform_admin` | — | `InternalSupportDeskController.sweep` | guards: `TenantGuard` |
| `GET` | `/internal/support/queues` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `InternalSupportCatalogController.queues` | guards: `TenantGuard` |
| `POST` | `/merchant/support/cases` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantSupportController.openCase` | guards: `TenantGuard` |
| `GET` | `/merchant/support/cases/:caseId` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantSupportController.getCase` | guards: `TenantGuard` |
| `POST` | `/merchant/support/cases/:caseId/close-request` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantSupportController.closeRequest` | guards: `TenantGuard` |
| `POST` | `/merchant/support/cases/:caseId/feedback` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantSupportController.feedback` | guards: `TenantGuard` |
| `GET` | `/merchant/support/categories` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantSupportController.categories` | guards: `TenantGuard` |
| `GET` | `/merchant/support/faq` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantSupportController.faq` | guards: `TenantGuard` |
| `GET` | `/merchant/support/knowledge/search` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantSupportController.search` | guards: `TenantGuard` |
| `GET` | `/merchant/support/partners/:partnerProfileId/cases` | `merchant`, `internal_operator`, `admin`, `platform_admin` | — | `MerchantSupportController.listCases` | guards: `TenantGuard` |
| `GET` | `/mobile/support/cases` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.listCases` | guards: `TenantGuard` |
| `POST` | `/mobile/support/cases` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.openCase` | guards: `TenantGuard` |
| `GET` | `/mobile/support/cases/:caseId` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.getCase` | guards: `TenantGuard` |
| `POST` | `/mobile/support/cases/:caseId/close-request` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.closeRequest` | guards: `TenantGuard` |
| `POST` | `/mobile/support/cases/:caseId/feedback` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.feedback` | guards: `TenantGuard` |
| `POST` | `/mobile/support/cases/:caseId/reopen` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.reopen` | guards: `TenantGuard` |
| `GET` | `/mobile/support/categories` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.categories` | guards: `TenantGuard` |
| `GET` | `/mobile/support/faq` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.faq` | guards: `TenantGuard` |
| `POST` | `/mobile/support/knowledge/articles/:articleId/feedback` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.articleFeedback` | guards: `TenantGuard` |
| `GET` | `/mobile/support/knowledge/articles/:articleKey` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.article` | guards: `TenantGuard` |
| `GET` | `/mobile/support/knowledge/search` | `customer`, `internal_operator`, `admin`, `platform_admin` | — | `MobileSupportController.search` | guards: `TenantGuard` |
| `GET` | `/support/attachments/:attachmentId/content` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportAttachmentsController.content` | guards: `TenantGuard` |
| `POST` | `/support/channels` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.open` | guards: `TenantGuard` |
| `POST` | `/support/channels/:channelId/attachments/ticket` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportAttachmentsController.ticket` | guards: `TenantGuard` |
| `POST` | `/support/channels/:channelId/close` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.close` | guards: `TenantGuard` |
| `GET` | `/support/channels/:channelId/messages` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.transcript` | guards: `TenantGuard` |
| `POST` | `/support/channels/:channelId/messages` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.send` | guards: `TenantGuard` |
| `POST` | `/support/channels/:channelId/messages/:messageId/corrections` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.correct` | guards: `TenantGuard` |
| `POST` | `/support/channels/:channelId/read` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.read` | guards: `TenantGuard` |
| `GET` | `/support/channels/:channelId/stream` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.stream` | guards: `TenantGuard` |
| `POST` | `/support/channels/:channelId/typing` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.typing` | guards: `TenantGuard` |
| `GET` | `/support/channels/unread` | `customer`, `merchant`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `SupportChatController.unread` | guards: `TenantGuard` |

## `systems-ops`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/systems/action-logs` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsActionLogController.listActionLogs` | — |
| `GET` | `/systems/action-logs/by-request/:requestId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsActionLogController.getActionLogsByRequest` | — |
| `GET` | `/systems/action-logs/filter-catalog` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsActionLogController.getActionLogFilterCatalog` | — |
| `GET` | `/systems/action-logs/request/:requestId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsActionLogController.getActionLogsByRequestAlias` | — |
| `GET` | `/systems/blocks` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsNetworkController.listBlocks` | — |
| `POST` | `/systems/blocks/:systemCode/federate` | `system_admin`, `platform_admin`, `admin` | — | `SystemsNetworkController.federateBlock` | — |
| `POST` | `/systems/blocks/federate` | `system_admin`, `platform_admin`, `admin` | — | `SystemsNetworkController.federateAll` | — |
| `GET` | `/systems/catalog/summary` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getCatalogSummary` | — |
| `GET` | `/systems/dashboard` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getDashboard` | — |
| `GET` | `/systems/data-entities` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.listDataEntities` | — |
| `GET` | `/systems/data-entities/:entityId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getDataEntity` | — |
| `PATCH` | `/systems/data-entities/:entityId/metadata` | `system_admin`, `platform_admin`, `admin` | — | `SystemsCatalogController.updateDataEntityMetadata` | — |
| `PATCH` | `/systems/data-entities/:entityId/review` | `system_admin`, `platform_admin`, `admin` | — | `SystemsReviewController.reviewDataEntity` | — |
| `PATCH` | `/systems/data-entities/columns/:columnId/review` | `system_admin`, `platform_admin`, `admin` | — | `SystemsReviewController.reviewDataColumn` | — |
| `POST` | `/systems/data-entities/infer-impacts` | `system_admin`, `platform_admin`, `admin` | — | `SystemsCatalogController.inferDataImpacts` | — |
| `GET` | `/systems/decision-engine/artifacts` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsNetworkController.listActiveArtifacts` | — |
| `GET` | `/systems/domains` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.listDomains` | — |
| `GET` | `/systems/domains/:domainCode` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getDomain` | — |
| `GET` | `/systems/domains/overview` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getDomainOverview` | — |
| `GET` | `/systems/endpoints` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.listEndpoints` | — |
| `GET` | `/systems/endpoints/:endpointId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getEndpoint` | — |
| `PATCH` | `/systems/endpoints/:endpointId/review` | `system_admin`, `platform_admin`, `admin` | — | `SystemsReviewController.reviewEndpoint` | — |
| `POST` | `/systems/endpoints/catalog-seed/refresh` | `system_admin`, `platform_admin`, `admin` | — | `SystemsCatalogController.refreshCatalogSeed` | — |
| `POST` | `/systems/endpoints/discover` | `system_admin`, `platform_admin`, `admin` | — | `SystemsCatalogController.discoverEndpoints` | — |
| `GET` | `/systems/flows` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.list` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/:flowId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.detail` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/:flowId/graph` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.flowGraph` | guards: `InternalPermissionsGuard` |
| `PATCH` | `/systems/flows/:flowId/review` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.review` | `SystemFlowsReviewController.reviewFlow` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/business` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.businessFlows` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/documentation-gate` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsReviewController.documentationGate` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/findings` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.findings` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/graph` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.moduleGraph` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/import/contract` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.importContract` | guards: `InternalPermissionsGuard` |
| `POST` | `/systems/flows/import/endpoints` | `system_admin`, `platform_admin`, `admin` | `systems.flows.analyze` | `SystemFlowsController.importEndpoints` | guards: `InternalPermissionsGuard` |
| `POST` | `/systems/flows/import/findings` | `system_admin`, `platform_admin`, `admin` | `systems.flows.analyze` | `SystemFlowsController.importFindings` | guards: `InternalPermissionsGuard` |
| `POST` | `/systems/flows/import/screens` | `system_admin`, `platform_admin`, `admin` | `systems.flows.analyze` | `SystemFlowsController.importScreens` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/imports` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.imports` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/modules` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.modules` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/pending-work` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.pendingWork` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/rbac-drift` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.rbacDrift` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/review-queue` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsReviewController.reviewQueue` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/screens` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.screens` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/flows/summary` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`, `internal_operator` | `systems.flows.read` | `SystemFlowsController.summary` | guards: `InternalPermissionsGuard` |
| `POST` | `/systems/flows/verify` | `system_admin`, `platform_admin`, `admin` | `systems.flows.analyze` | `SystemFlowsController.verify` | guards: `InternalPermissionsGuard` |
| `GET` | `/systems/health/network` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsNetworkController.getNetworkHealth` | — |
| `GET` | `/systems/health/tools` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getToolsHealth` | — |
| `GET` | `/systems/impact/by-endpoint/:endpointId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getImpactByEndpoint` | — |
| `GET` | `/systems/impact/by-table/:schemaName/:tableName` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getImpactByTable` | — |
| `PATCH` | `/systems/impact/data/:impactId/review` | `system_admin`, `platform_admin`, `admin` | — | `SystemsReviewController.reviewDataImpact` | — |
| `PATCH` | `/systems/impact/fields/:fieldImpactId/review` | `system_admin`, `platform_admin`, `admin` | — | `SystemsReviewController.reviewFieldImpact` | — |
| `GET` | `/systems/monitor/host` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsMonitorHostController.getHost` | — |
| `POST` | `/systems/monitor/host-snapshot` | identidad de servicio `{"scope":"systems:monitor:write","audienceContext":"systems","allowedServices":["atlas-monitor"]}` | — | `SystemsMonitorController.ingestHostSnapshot` | guards: `ServiceTokenGuard` |
| `GET` | `/systems/monitor/summary` | identidad de servicio `{"scope":"systems:monitor:read","audienceContext":"systems","allowedServices":["atlas-monitor"]}` | — | `SystemsMonitorController.getSummary` | guards: `ServiceTokenGuard` |
| `GET` | `/systems/reports/traffic-latency` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsActionLogController.getTrafficLatencyReport` | — |
| `GET` | `/systems/reports/traffic-latency-timeseries` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsActionLogController.getTrafficLatencyTimeseries` | — |
| `GET` | `/systems/review-queue` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsReviewController.getReviewQueue` | — |
| `GET` | `/systems/stress-matrix` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsStressController.getStressMatrix` | — |
| `GET` | `/systems/stress-profiles` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsStressController.listStressProfiles` | — |
| `POST` | `/systems/stress-profiles` | `system_admin`, `platform_admin`, `qa_engineer`, `devops` | — | `SystemsStressController.upsertStressProfile` | — |
| `GET` | `/systems/stress-profiles/:profileId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsStressController.getStressProfile` | — |
| `POST` | `/systems/stress-profiles/:profileId/queue-run` | `system_admin`, `platform_admin`, `qa_engineer`, `devops` | — | `SystemsStressController.queueStressRun` | — |
| `GET` | `/systems/stress-runs` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsStressController.listStressRuns` | — |
| `GET` | `/systems/stress-runs/capabilities` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsStressController.getStressRunCapabilities` | — |
| `GET` | `/systems/test-runs` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsTestController.listTestRuns` | — |
| `GET` | `/systems/test-runs/:runId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsTestController.getTestRun` | — |
| `GET` | `/systems/test-suites` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsTestController.listTestSuites` | — |
| `POST` | `/systems/test-suites` | `system_admin`, `platform_admin`, `qa_engineer` | — | `SystemsTestController.createTestSuite` | — |
| `GET` | `/systems/test-suites/:suiteId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsTestController.getTestSuite` | — |
| `PATCH` | `/systems/test-suites/:suiteId` | `system_admin`, `platform_admin`, `qa_engineer` | — | `SystemsTestController.updateTestSuite` | — |
| `POST` | `/systems/test-suites/:suiteId/run` | `system_admin`, `platform_admin`, `qa_engineer` | — | `SystemsTestController.runTestSuite` | — |
| `POST` | `/systems/test-suites/:suiteId/steps` | `system_admin`, `platform_admin`, `qa_engineer` | — | `SystemsTestController.createTestStep` | — |
| `PATCH` | `/systems/test-suites/:suiteId/steps/:stepId` | `system_admin`, `platform_admin`, `qa_engineer` | — | `SystemsTestController.updateTestStep` | — |
| `POST` | `/systems/test-suites/:suiteId/steps/reorder` | `system_admin`, `platform_admin`, `qa_engineer` | — | `SystemsTestController.reorderTestSteps` | — |
| `GET` | `/systems/tools` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.listTools` | — |
| `GET` | `/systems/tools/:toolId` | `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor` | — | `SystemsCatalogController.getTool` | — |
| `POST` | `/systems/tools/infer-requirements` | `system_admin`, `platform_admin`, `admin` | — | `SystemsCatalogController.inferToolRequirements` | — |
| `PATCH` | `/systems/tools/requirements/:requirementId/review` | `system_admin`, `platform_admin`, `admin` | — | `SystemsReviewController.reviewToolRequirement` | — |

## `workflow-catalog`

| Método | Ruta | Acceso | Permiso fino | Handler | Notas |
|---|---|---|---|---|---|
| `GET` | `/customers/:customerId/workflow-progress` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin` | — | `WorkflowProgressController.getProgress` | guards: `TenantGuard` |
| `GET` | `/internal/processes` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system_admin` | `workflows.read` | `ProcessCatalogController.list` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/internal/processes/:code` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system_admin` | `workflows.read` | `ProcessCatalogController.detail` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/internal/processes/:code/instances` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system_admin` | `workflows.read` | `ProcessCatalogController.instances` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/internal/processes/:code/instances/:instanceId/progress` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system_admin` | `workflows.read` | `ProcessCatalogController.instanceProgress` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/internal/processes/:code/wiring` | `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `qa_engineer`, `readonly_auditor`, `admin`, `platform_admin`, `system_admin` | `workflows.read` | `ProcessCatalogController.wiring` | guards: `TenantGuard`, `InternalPermissionsGuard` |
| `GET` | `/operations/workflows/:workflowCode/consistency` | `system_admin`, `qa_engineer`, `devops`, `admin`, `platform_admin` | — | `WorkflowOperationsController.checkConsistency` | — |
| `GET` | `/workflows` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `admin`, `platform_admin` | — | `WorkflowCatalogController.list` | — |
| `GET` | `/workflows/:workflowCode` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `admin`, `platform_admin` | — | `WorkflowCatalogController.getTree` | — |
| `GET` | `/workflows/:workflowCode/graph` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `admin`, `platform_admin` | — | `WorkflowCatalogController.getGraph` | — |
| `GET` | `/workflows/:workflowCode/stages` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `admin`, `platform_admin` | — | `WorkflowCatalogController.listStages` | — |
| `GET` | `/workflows/:workflowCode/transitions` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `admin`, `platform_admin` | — | `WorkflowCatalogController.listTransitions` | — |
| `POST` | `/workflows/:workflowCode/transitions/validate` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `admin`, `platform_admin` | — | `WorkflowCatalogController.validateTransition` | — |
| `GET` | `/workflows/:workflowCode/versions` | `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `system_admin`, `qa_engineer`, `devops`, `readonly_auditor`, `admin`, `platform_admin` | — | `WorkflowCatalogController.listVersions` | — |
