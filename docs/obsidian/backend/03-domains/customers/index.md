---
title: "customers"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "customers"
module: "CustomersModule"
tags:
  - "backend"
  - "domain"
  - "module/customers"
source_files:
  - "src/modules/customers/customers.module.ts"
  - "src/modules/customers/customer-eligibility.controller.ts"
  - "src/modules/customers/customers.controller.ts"
endpoints:
  - "GET /customers/:customerId/eligibility"
  - "POST /operations/customers/:customerId/eligibility/decision"
  - "GET /customers/:customerId/me"
dependencies: []
---
# Módulo `customers`

Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.

**Papel técnico:** expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.

| | |
|---|---|
| Clase | `CustomersModule` |
| Archivos | 18 |
| Controllers | 2 |
| Rutas HTTP | 3 |
| Modelos usados | 23 |
| Esquemas de datos | [[catalog-schema\|catalog]], [[iam-schema\|iam]], [[privacy-schema\|privacy]], [[customer-schema\|customer]], [[audit-schema\|audit]], [[case_management-schema\|case_management]], [[telemetry-schema\|telemetry]], [[platform_ops-schema\|platform_ops]], [[risk-schema\|risk]] |

## Entradas

3 rutas HTTP. Contrato completo en [[04-api/rest/customer-eligibility\|customer-eligibility]], [[04-api/rest/customers\|customers]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/customers/:customerId/eligibility` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `POST` | `/operations/customers/:customerId/eligibility/decision` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` |
| `GET` | `/customers/:customerId/me` | 🔒 | `...` |

## Salidas y efectos

Persiste en 23 tabla(s):

- [[attribute_definitions]] (`catalog`)
- [[auth_credentials]] (`iam`)
- [[consent_documents]] (`privacy`)
- [[customer_addresses]] (`customer`)
- [[customer_attribute_values]] (`catalog`)
- [[customer_consents]] (`privacy`)
- [[customer_contact_methods]] (`customer`)
- [[customer_eligibility_evaluations]] (`customer`)
- [[customer_identity_documents]] (`customer`)
- [[customers]] (`customer`)
- [[customer_profile_versions]] (`customer`)
- [[customer_reference_contacts]] (`customer`)
- [[customer_status_events]] (`customer`)
- [[data_quality_issues]] (`audit`)
- [[evidence_documents]] (`privacy`)
- [[evidence_reviews]] (`privacy`)
- [[fraud_cases]] (`case_management`)
- [[identity_verification_attempts]] (`customer`)
- [[manual_review_cases]] (`case_management`)
- [[onboarding_flows]] (`telemetry`)
- [[outbox_events]] (`platform_ops`)
- [[risk_assessment_results]] (`risk`)
- [[watchlist_matches]] (`case_management`)

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** [[03-domains/auth/index\|auth]], [[03-domains/consents/index\|consents]], [[03-domains/credit/index\|credit]], [[03-domains/customer-onboarding/index\|customer-onboarding]], [[03-domains/customer-privacy/index\|customer-privacy]], [[03-domains/customer-telemetry/index\|customer-telemetry]], [[03-domains/fraud/index\|fraud]], [[03-domains/notifications/index\|notifications]], [[03-domains/operations/index\|operations]], [[03-domains/risk/index\|risk]], [[03-domains/sessions/index\|sessions]], [[03-domains/workflow-catalog/index\|workflow-catalog]]

**Exporta:** `CustomersService`, `CustomersRepository`, `CustomerLifecycleService`, `CustomerEligibilityService`, `CustomerEligibilityRepository`

> [!warning] Exporta un repositorio
> Otros módulos pueden llegar a la persistencia de este dominio sin pasar por su servicio, saltándose las reglas que vivan ahí. La regla del proyecto solo lo admite con necesidad transaccional real y documentada.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `customer-eligibility.controller.ts`, `customers.controller.ts` |
| Services | `customers.service.ts`, `application/customer-eligibility-decision.service.ts`, `application/customer-eligibility.service.ts`, `application/customer-lifecycle.service.ts` |
| Repositories | `customers.repository.ts`, `repositories/customer-eligibility.repository.ts`, `repositories/customer-lifecycle.repository.ts` |
| Esquemas Zod | `customer-eligibility.schemas.ts`, `customers.schemas.ts` |
| Mappers | `customers.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `...`.


## Pruebas

10 archivo(s) de test:

- `test/unit/customers/customer-eligibility-decision.service.spec.ts`
- `test/unit/customers/customer-eligibility.evaluator.spec.ts`
- `test/unit/customers/customer-eligibility.repository.spec.ts`
- `test/unit/customers/customer-eligibility.service.spec.ts`
- `test/unit/customers/customer-lifecycle.service.spec.ts`
- `test/unit/customers/customers-repository-active-ids.spec.ts`
- `test/unit/customers/customers.controller.spec.ts`
- `test/unit/customers/customers.mapper.spec.ts`
- `test/unit/customers/customers.repository.spec.ts`
- `test/unit/customers/customers.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/customers/customers.module.ts`](../../../../../src/modules/customers/customers.module.ts)
- Controller `CustomerEligibilityController`: [`src/modules/customers/customer-eligibility.controller.ts`](../../../../../src/modules/customers/customer-eligibility.controller.ts)
- Controller `CustomersController`: [`src/modules/customers/customers.controller.ts`](../../../../../src/modules/customers/customers.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
