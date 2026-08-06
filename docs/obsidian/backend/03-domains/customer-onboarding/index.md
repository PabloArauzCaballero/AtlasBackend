---
title: "customer-onboarding"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "customer-onboarding"
module: "CustomerOnboardingModule"
tags:
  - "backend"
  - "domain"
  - "module/customer-onboarding"
source_files:
  - "src/modules/customer-onboarding/customer-onboarding.module.ts"
  - "src/modules/customer-onboarding/customer-onboarding-profile.controller.ts"
  - "src/modules/customer-onboarding/customer-onboarding-status.controller.ts"
  - "src/modules/customer-onboarding/customer-onboarding.controller.ts"
  - "src/modules/customer-onboarding/customer-verification.controller.ts"
endpoints:
  - "PATCH /customer-onboarding/:customerId/profile"
  - "PUT /customer-onboarding/:customerId/financial-profile"
  - "GET /customer-onboarding/:customerId/reference-contacts"
  - "POST /customer-onboarding/:customerId/reference-contacts"
  - "DELETE /customer-onboarding/:customerId/reference-contacts/:referenceId"
  - "POST /customer-onboarding/:customerId/contact-methods"
  - "POST /customer-onboarding/:customerId/documents/upload-url"
  - "POST /customer-onboarding/:customerId/identity-verification"
  - "GET /customer-onboarding/:customerId/status"
  - "POST /customer-onboarding/:customerId/submit"
  - "GET /customer-onboarding/:customerId/observations"
  - "POST /customer-onboarding/jobs/mark-abandoned"
  - "POST /customer-onboarding/start"
  - "POST /customer-onboarding/:customerId/contact-verification/request"
  - "POST /customer-onboarding/:customerId/contact-verification/submit"
  - "POST /customer-onboarding/:customerId/identity-package"
  - "POST /customer-onboarding/:customerId/address-package"
  - "POST /operations/customers/:customerId/identity-verification/decision"
  - "POST /operations/customers/:customerId/compliance/screening"
  - "POST /operations/customers/:customerId/compliance/clear-matches"
dependencies:
  - "CustomersModule"
  - "SessionsModule"
  - "ConsentsModule"
  - "AuthModule"
  - "MailSenderModule"
  - "NotificationsModule"
  - "ExternalDataModule"
---
# Módulo `customer-onboarding`

Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.

**Papel técnico:** orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.

| | |
|---|---|
| Clase | `CustomerOnboardingModule` |
| Archivos | 35 |
| Controllers | 4 |
| Rutas HTTP | 20 (**1 públicas**) |
| Modelos usados | 27 |
| Esquemas de datos | [[customer-schema\|customer]], [[catalog-schema\|catalog]], [[telemetry-schema\|telemetry]], [[case_management-schema\|case_management]], [[integrations-schema\|integrations]], [[privacy-schema\|privacy]], [[audit-schema\|audit]] |

## Entradas

20 rutas HTTP. Contrato completo en [[04-api/rest/customer-onboarding\|customer-onboarding]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `PATCH` | `/customer-onboarding/:customerId/profile` | 🔒 | `...CUSTOMER_AND_INTERNAL` |
| `PUT` | `/customer-onboarding/:customerId/financial-profile` | 🔒 | `...CUSTOMER_AND_INTERNAL` |
| `GET` | `/customer-onboarding/:customerId/reference-contacts` | 🔒 | `...CUSTOMER_AND_INTERNAL` |
| `POST` | `/customer-onboarding/:customerId/reference-contacts` | 🔒 | `...CUSTOMER_AND_INTERNAL` |
| `DELETE` | `/customer-onboarding/:customerId/reference-contacts/:referenceId` | 🔒 | `...CUSTOMER_AND_INTERNAL` |
| `POST` | `/customer-onboarding/:customerId/contact-methods` | 🔒 | `...CUSTOMER_AND_INTERNAL` |
| `POST` | `/customer-onboarding/:customerId/documents/upload-url` | 🔒 | `...CUSTOMER_AND_INTERNAL` |
| `POST` | `/customer-onboarding/:customerId/identity-verification` | 🔒 | `...CUSTOMER_AND_INTERNAL` |
| `GET` | `/customer-onboarding/:customerId/status` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/customer-onboarding/:customerId/submit` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `GET` | `/customer-onboarding/:customerId/observations` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/customer-onboarding/jobs/mark-abandoned` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/customer-onboarding/start` | 🔓 | — |
| `POST` | `/customer-onboarding/:customerId/contact-verification/request` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/customer-onboarding/:customerId/contact-verification/submit` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/customer-onboarding/:customerId/identity-package` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/customer-onboarding/:customerId/address-package` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/operations/customers/:customerId/identity-verification/decision` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` |
| `POST` | `/operations/customers/:customerId/compliance/screening` | 🔒 | `compliance_analyst` `risk_analyst` `admin` `platform_admin` |
| `POST` | `/operations/customers/:customerId/compliance/clear-matches` | 🔒 | `compliance_analyst` `admin` `platform_admin` |

## Salidas y efectos

Persiste en 27 tabla(s):

- [[address_gps_observations]] (`customer`)
- [[attribute_definitions]] (`catalog`)
- [[auth_events]] (`telemetry`)
- [[contact_verification_attempts]] (`customer`)
- [[customer_action_logs]] (`telemetry`)
- [[customer_addresses]] (`customer`)
- [[customer_address_versions]] (`customer`)
- [[customer_attribute_values]] (`catalog`)
- [[customer_contact_methods]] (`customer`)
- [[customer_identity_documents]] (`customer`)
- [[customers]] (`customer`)
- [[customer_observations]] (`catalog`)
- [[customer_profile_versions]] (`customer`)
- [[customer_reference_contacts]] (`customer`)
- [[watchlist_entries]] (`case_management`)
- [[watchlist_matches]] (`case_management`)
- [[customer_status_events]] (`customer`)
- [[data_provider_requests]] (`integrations`)
- [[data_provider_responses]] (`integrations`)
- [[evidence_documents]] (`privacy`)
- [[evidence_extractions]] (`privacy`)
- [[evidence_reviews]] (`privacy`)
- [[identity_verification_attempts]] (`customer`)
- [[onboarding_flows]] (`telemetry`)
- [[onboarding_step_events]] (`telemetry`)
- [[operational_audit_logs]] (`audit`)
- [[permission_events]] (`telemetry`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]], [[03-domains/sessions/index\|sessions]], [[03-domains/consents/index\|consents]], [[03-domains/auth/index\|auth]], [[03-domains/mail-sender/index\|mail-sender]], [[03-domains/notifications/index\|notifications]], [[03-domains/external-data/index\|external-data]]

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `customer-onboarding-profile.controller.ts`, `customer-onboarding-status.controller.ts`, `customer-onboarding.controller.ts`, `customer-verification.controller.ts` |
| Services | `customer-onboarding.service.ts`, `application/contact-verification-code.service.ts`, `application/contact-verification-journal.service.ts`, `application/customer-address-package.service.ts`, `application/customer-compliance-screening.service.ts`, `application/customer-contact-methods.service.ts`, `application/customer-contact-verification.service.ts`, `application/customer-document-upload.service.ts`, `application/customer-financial-profile.service.ts`, `application/customer-identity-package.service.ts`, `application/customer-identity-provider-verification.service.ts`, `application/customer-onboarding-guards.service.ts`, `application/customer-onboarding-start.service.ts`, `application/customer-onboarding-status.service.ts`, `application/customer-profile-update.service.ts`, `application/customer-reference-contacts.service.ts`, `application/customer-verification.service.ts`, `application/onboarding-abandonment.service.ts` |
| Repositories | `customer-onboarding.repository.ts`, `repositories/customer-address-status.repository.ts`, `repositories/customer-contact-verification.repository.ts`, `repositories/customer-identity-evidence.repository.ts`, `repositories/customer-onboarding-flow.repository.ts`, `repositories/customer-profile-data.repository.ts`, `repositories/customer-verification.repository.ts` |
| Esquemas Zod | `customer-onboarding-profile.schemas.ts`, `customer-onboarding.schemas.ts` |
| Mappers | `customer-onboarding.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `...CUSTOMER_AND_INTERNAL`, `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `system`, `compliance_analyst`.

> [!danger] Superficie pública
> 1 ruta(s) sin JWT: `POST /customer-onboarding/start`.

## Pruebas

20 archivo(s) de test:

- `test/unit/customer-onboarding/contact-verification-code.service.spec.ts`
- `test/unit/customer-onboarding/customer-address-package.service.spec.ts`
- `test/unit/customer-onboarding/customer-address-status.repository.spec.ts`
- `test/unit/customer-onboarding/customer-contact-verification.repository.spec.ts`
- `test/unit/customer-onboarding/customer-contact-verification.service.spec.ts`
- `test/unit/customer-onboarding/customer-identity-evidence.repository.spec.ts`
- `test/unit/customer-onboarding/customer-identity-package.service.spec.ts`
- `test/unit/customer-onboarding/customer-identity-provider-verification.service.spec.ts`
- `test/unit/customer-onboarding/customer-onboarding-flow.repository.spec.ts`
- `test/unit/customer-onboarding/customer-onboarding-guards.service.spec.ts`
- `test/unit/customer-onboarding/customer-onboarding-repository-facade.spec.ts`
- `test/unit/customer-onboarding/customer-onboarding-start.service.spec.ts`
- `test/unit/customer-onboarding/customer-onboarding-status.service.spec.ts`
- `test/unit/customer-onboarding/customer-onboarding.controller.spec.ts`
- `test/unit/customer-onboarding/customer-onboarding.mapper.spec.ts`
- … y 5 más

## Referencias al código

- Módulo: [`src/modules/customer-onboarding/customer-onboarding.module.ts`](../../../../src/modules/customer-onboarding/customer-onboarding.module.ts)
- Controller `CustomerOnboardingProfileController`: [`src/modules/customer-onboarding/customer-onboarding-profile.controller.ts`](../../../../src/modules/customer-onboarding/customer-onboarding-profile.controller.ts)
- Controller `CustomerOnboardingStatusController`: [`src/modules/customer-onboarding/customer-onboarding-status.controller.ts`](../../../../src/modules/customer-onboarding/customer-onboarding-status.controller.ts)
- Controller `CustomerOnboardingController`: [`src/modules/customer-onboarding/customer-onboarding.controller.ts`](../../../../src/modules/customer-onboarding/customer-onboarding.controller.ts)
- Controller `CustomerVerificationController`: [`src/modules/customer-onboarding/customer-verification.controller.ts`](../../../../src/modules/customer-onboarding/customer-verification.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
