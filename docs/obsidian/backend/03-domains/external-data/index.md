---
title: "external-data"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "external-data"
module: "ExternalDataModule"
tags:
  - "backend"
  - "domain"
  - "module/external-data"
source_files:
  - "src/modules/external-data/external-data.module.ts"
  - "src/modules/external-data/controllers/kyc-bureau.controller.ts"
  - "src/modules/external-data/controllers/kyc-bureau.controller.ts"
  - "src/modules/external-data/controllers/payments-telco.controller.ts"
  - "src/modules/external-data/controllers/payments-telco.controller.ts"
  - "src/modules/external-data/controllers/social-trust.controller.ts"
  - "src/modules/external-data/controllers/social-trust.controller.ts"
  - "src/modules/external-data/controllers/social-trust.controller.ts"
  - "src/modules/external-data/external-data.controller.ts"
  - "src/modules/external-data/external-data.controller.ts"
endpoints:
  - "POST /kyc/segip/verify"
  - "POST /bureau/infocenter/check"
  - "POST /payments/qr/verify"
  - "POST /payments/bank-transfer/verify"
  - "POST /payments/bank-transfer/qr"
  - "POST /telco/phone-trust/verify"
  - "GET /telco/phone-trust/:customerId"
  - "GET /social/facebook/connect-url"
  - "POST /social/facebook/callback"
  - "GET /social/facebook/status/:customerId"
  - "POST /whatsapp/verification/start"
  - "POST /whatsapp/verification/confirm"
  - "GET /whatsapp/status/:customerId"
  - "POST /digital-trust/check"
  - "GET /digital-trust/profile/:customerId"
  - "POST /external-data/consents"
  - "GET /external-data/consents/user/:customerId"
  - "POST /external-data/consents/:consentId/revoke"
  - "POST /external-data/requests/preview"
  - "POST /external-data/requests"
  - "GET /external-data/requests/:requestId"
  - "GET /external-data/providers/health"
  - "GET /external-data/users/:customerId/features"
  - "GET /external-data/users/:customerId/scoring-input"
  - "GET /external-data/users/:customerId/decision-package"
  - "GET /external-data/users/:customerId/observations"
  - "GET /admin/external-providers"
  - "GET /admin/external-providers/health"
  - "GET /admin/external-providers/readiness"
  - "GET /admin/external-providers/quality-audit"
  - "GET /admin/external-providers/production-gate"
  - "GET /admin/external-providers/sla"
  - "GET /admin/external-providers/usage"
  - "GET /admin/external-providers/idempotency-audit"
  - "GET /admin/external-providers/retention/preview"
  - "GET /admin/external-providers/sanitization-audit"
  - "POST /admin/external-providers/policy/preview"
  - "PATCH /admin/external-providers/:providerCode/runtime"
  - "POST /admin/external-providers/:providerCode/kill-switch"
  - "GET /admin/external-providers/:providerCode/cost-policy"
  - "PATCH /admin/external-providers/:providerCode/cost-policy/:queryType"
  - "POST /admin/external-providers/:providerCode/test"
  - "POST /admin/external-providers/requests/:requestId/approve"
  - "POST /admin/external-providers/requests/:requestId/retry"
  - "POST /admin/external-providers/requests/:requestId/rebuild-features"
dependencies: []
---
# Módulo `external-data`

Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.

**Papel técnico:** aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.

| | |
|---|---|
| Clase | `ExternalDataModule` |
| Archivos | 29 |
| Controllers | 9 |
| Rutas HTTP | 45 |
| Modelos usados | 8 |
| Esquemas de datos | [[privacy-schema\|privacy]], [[catalog-schema\|catalog]], [[integrations-schema\|integrations]], [[risk-schema\|risk]] |

## Entradas

45 rutas HTTP. Contrato completo en [[04-api/rest/kyc\|kyc]], [[04-api/rest/bureau\|bureau]], [[04-api/rest/payments-external\|payments-external]], [[04-api/rest/telco\|telco]], [[04-api/rest/social\|social]], [[04-api/rest/whatsapp\|whatsapp]], [[04-api/rest/digital-trust\|digital-trust]], [[04-api/rest/external-data\|external-data]], [[04-api/rest/external-data-admin\|external-data-admin]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `POST` | `/kyc/segip/verify` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `POST` | `/bureau/infocenter/check` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `POST` | `/payments/qr/verify` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/payments/bank-transfer/verify` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/payments/bank-transfer/qr` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/telco/phone-trust/verify` | 🔒 | `customer` `internal_operator` `risk_analyst` `fraud_analyst` |
| `GET` | `/telco/phone-trust/:customerId` | 🔒 | `customer` `internal_operator` `risk_analyst` `fraud_analyst` |
| `GET` | `/social/facebook/connect-url` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/social/facebook/callback` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `GET` | `/social/facebook/status/:customerId` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/whatsapp/verification/start` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/whatsapp/verification/confirm` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `GET` | `/whatsapp/status/:customerId` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/digital-trust/check` | 🔒 | `customer` `internal_operator` `risk_analyst` `fraud_analyst` |
| `GET` | `/digital-trust/profile/:customerId` | 🔒 | `customer` `internal_operator` `risk_analyst` `fraud_analyst` |
| `POST` | `/external-data/consents` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/external-data/consents/user/:customerId` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `POST` | `/external-data/consents/:consentId/revoke` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `POST` | `/external-data/requests/preview` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `POST` | `/external-data/requests` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/external-data/requests/:requestId` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/external-data/providers/health` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/external-data/users/:customerId/features` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/external-data/users/:customerId/scoring-input` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/external-data/users/:customerId/decision-package` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/external-data/users/:customerId/observations` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/health` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/readiness` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/quality-audit` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/production-gate` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/sla` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/usage` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/idempotency-audit` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/retention/preview` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/sanitization-audit` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `POST` | `/admin/external-providers/policy/preview` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `PATCH` | `/admin/external-providers/:providerCode/runtime` | 🔒 | `admin` `platform_admin` |
| `POST` | `/admin/external-providers/:providerCode/kill-switch` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |
| `GET` | `/admin/external-providers/:providerCode/cost-policy` | 🔒 | `admin` `platform_admin` `risk_analyst` `compliance_analyst` |

… y 5 más. Ver [[15-reference/endpoint-catalog]].

## Salidas y efectos

Persiste en 8 tabla(s):

- [[customer_consents]] (`privacy`)
- [[customer_observations]] (`catalog`)
- [[data_providers]] (`integrations`)
- [[data_provider_requests]] (`integrations`)
- [[data_provider_responses]] (`integrations`)
- [[external_provider_cost_policies]] (`integrations`)
- [[feature_snapshots]] (`risk`)
- [[provider_health_logs]] (`integrations`)

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** [[03-domains/customer-onboarding/index\|customer-onboarding]]

**Exporta:** `ExternalDataService`

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `external-data.controller.ts`, `controllers/kyc-bureau.controller.ts`, `controllers/payments-telco.controller.ts`, `controllers/social-trust.controller.ts` |
| Services | `external-data.service.ts`, `application/banking-qr.service.ts`, `application/external-data-decision.service.ts`, `application/external-data-evidence.service.ts`, `application/external-data-execution.service.ts`, `application/external-data-governance.service.ts`, `application/external-provider-convenience.service.ts`, `application/external-provider-registry.service.ts` |
| Repositories | `external-data.repository.ts` |
| Esquemas Zod | `external-data.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`.


## Pruebas

29 archivo(s) de test:

- `test/unit/external-data/adapters-production-guard.spec.ts`
- `test/unit/external-data/banking-generic.adapter.spec.ts`
- `test/unit/external-data/banking-qr.service.spec.ts`
- `test/unit/external-data/banking-qr.util.spec.ts`
- `test/unit/external-data/digital-trust-generic.adapter.spec.ts`
- `test/unit/external-data/external-data-admin-roles.spec.ts`
- `test/unit/external-data/external-data-controller.util.spec.ts`
- `test/unit/external-data/external-data-decision.service.spec.ts`
- `test/unit/external-data/external-data-evidence.service.spec.ts`
- `test/unit/external-data/external-data-execution.service.spec.ts`
- `test/unit/external-data/external-data-governance.service.spec.ts`
- `test/unit/external-data/external-data-policy.util.spec.ts`
- `test/unit/external-data/external-data.controller.spec.ts`
- `test/unit/external-data/external-data.repository.spec.ts`
- `test/unit/external-data/external-data.service.spec.ts`
- … y 14 más

## Referencias al código

- Módulo: [`src/modules/external-data/external-data.module.ts`](../../../../src/modules/external-data/external-data.module.ts)
- Controller `KycExternalDataController`: [`src/modules/external-data/controllers/kyc-bureau.controller.ts`](../../../../src/modules/external-data/controllers/kyc-bureau.controller.ts)
- Controller `BureauExternalDataController`: [`src/modules/external-data/controllers/kyc-bureau.controller.ts`](../../../../src/modules/external-data/controllers/kyc-bureau.controller.ts)
- Controller `PaymentsExternalDataController`: [`src/modules/external-data/controllers/payments-telco.controller.ts`](../../../../src/modules/external-data/controllers/payments-telco.controller.ts)
- Controller `TelcoExternalDataController`: [`src/modules/external-data/controllers/payments-telco.controller.ts`](../../../../src/modules/external-data/controllers/payments-telco.controller.ts)
- Controller `FacebookExternalDataController`: [`src/modules/external-data/controllers/social-trust.controller.ts`](../../../../src/modules/external-data/controllers/social-trust.controller.ts)
- Controller `WhatsappExternalDataController`: [`src/modules/external-data/controllers/social-trust.controller.ts`](../../../../src/modules/external-data/controllers/social-trust.controller.ts)
- Controller `DigitalTrustExternalDataController`: [`src/modules/external-data/controllers/social-trust.controller.ts`](../../../../src/modules/external-data/controllers/social-trust.controller.ts)
- Controller `ExternalDataController`: [`src/modules/external-data/external-data.controller.ts`](../../../../src/modules/external-data/external-data.controller.ts)
- Controller `AdminExternalProvidersController`: [`src/modules/external-data/external-data.controller.ts`](../../../../src/modules/external-data/external-data.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
