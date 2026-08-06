---
title: "customer-privacy"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "customer-privacy"
module: "CustomerPrivacyModule"
tags:
  - "backend"
  - "domain"
  - "module/customer-privacy"
source_files:
  - "src/modules/customer-privacy/customer-privacy.module.ts"
  - "src/modules/customer-privacy/customer-privacy.controller.ts"
endpoints:
  - "POST /customers/:customerId/privacy/consent-decisions"
  - "POST /customers/:customerId/privacy/data-subject-requests"
dependencies:
  - "CustomersModule"
  - "ConsentsModule"
---
# Módulo `customer-privacy`

Esta pieza hace exigibles los derechos de privacidad y limita el uso de datos personales.

**Papel técnico:** gestiona decisiones de tratamiento y solicitudes del titular con auditoría y aislamiento por tenant.

| | |
|---|---|
| Clase | `CustomerPrivacyModule` |
| Archivos | 5 |
| Controllers | 1 |
| Rutas HTTP | 2 |
| Modelos usados | 6 |
| Esquemas de datos | [[privacy-schema\|privacy]], [[telemetry-schema\|telemetry]], [[customer-schema\|customer]], [[audit-schema\|audit]] |

## Entradas

2 rutas HTTP. Contrato completo en [[04-api/rest/customer-privacy\|customer-privacy]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `POST` | `/customers/:customerId/privacy/consent-decisions` | 🔒 | `customer` `internal_operator` `compliance_analyst` `admin` |
| `POST` | `/customers/:customerId/privacy/data-subject-requests` | 🔒 | `customer` `internal_operator` `compliance_analyst` `admin` |

## Salidas y efectos

Persiste en 6 tabla(s):

- [[consent_events]] (`privacy`)
- [[customer_action_logs]] (`telemetry`)
- [[customer_consents]] (`privacy`)
- [[customer_status_events]] (`customer`)
- [[data_subject_requests]] (`privacy`)
- [[operational_audit_logs]] (`audit`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]], [[03-domains/consents/index\|consents]]

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `customer-privacy.controller.ts` |
| Services | `customer-privacy.service.ts` |
| Repositories | `customer-privacy.repository.ts` |
| Esquemas Zod | `customer-privacy.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `customer`, `internal_operator`, `compliance_analyst`, `admin`, `platform_admin`.


## Pruebas

3 archivo(s) de test:

- `test/unit/customer-privacy/customer-privacy.controller.spec.ts`
- `test/unit/customer-privacy/customer-privacy.repository.spec.ts`
- `test/unit/customer-privacy/customer-privacy.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/customer-privacy/customer-privacy.module.ts`](../../../../src/modules/customer-privacy/customer-privacy.module.ts)
- Controller `CustomerPrivacyController`: [`src/modules/customer-privacy/customer-privacy.controller.ts`](../../../../src/modules/customer-privacy/customer-privacy.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
