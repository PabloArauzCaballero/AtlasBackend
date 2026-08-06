---
title: "credit"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "credit"
module: "CreditModule"
tags:
  - "backend"
  - "domain"
  - "module/credit"
source_files:
  - "src/modules/credit/credit.module.ts"
  - "src/modules/credit/credit-operations.controller.ts"
  - "src/modules/credit/credit.controller.ts"
endpoints:
  - "GET /operations/credit/products"
  - "POST /operations/credit/products"
  - "PATCH /operations/credit/products/:productId/status"
  - "POST /operations/credit/applications/:applicationId/decision"
  - "GET /operations/credit/applications/:applicationId"
  - "GET /customers/:customerId/credit-products"
  - "POST /customers/:customerId/credit-applications"
  - "GET /customers/:customerId/credit-applications"
dependencies:
  - "CustomersModule"
---
# Módulo `credit`

Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.

**Papel técnico:** coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.

| | |
|---|---|
| Clase | `CreditModule` |
| Archivos | 9 |
| Controllers | 2 |
| Rutas HTTP | 8 |
| Modelos usados | 3 |
| Esquemas de datos | [[credit-schema\|credit]] |

## Entradas

8 rutas HTTP. Contrato completo en [[04-api/rest/credit\|credit]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/operations/credit/products` | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` |
| `POST` | `/operations/credit/products` | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` |
| `PATCH` | `/operations/credit/products/:productId/status` | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` |
| `POST` | `/operations/credit/applications/:applicationId/decision` | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` |
| `GET` | `/operations/credit/applications/:applicationId` | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` |
| `GET` | `/customers/:customerId/credit-products` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `POST` | `/customers/:customerId/credit-applications` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |
| `GET` | `/customers/:customerId/credit-applications` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |

## Salidas y efectos

Persiste en 3 tabla(s):

- [[credit_application_events]] (`credit`)
- [[credit_applications]] (`credit`)
- [[credit_products]] (`credit`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]]

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** `CreditRepository`

> [!warning] Exporta un repositorio
> Otros módulos pueden llegar a la persistencia de este dominio sin pasar por su servicio, saltándose las reglas que vivan ahí. La regla del proyecto solo lo admite con necesidad transaccional real y documentada.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `credit-operations.controller.ts`, `credit.controller.ts` |
| Services | `application/credit-application.service.ts`, `application/credit-decision.service.ts`, `application/credit-product.service.ts` |
| Repositories | `credit.repository.ts` |
| Esquemas Zod | `credit.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `internal_operator`, `risk_analyst`, `admin`, `platform_admin`, `customer`.


## Pruebas

6 archivo(s) de test:

- `test/unit/credit/credit-application.service.spec.ts`
- `test/unit/credit/credit-product-and-decision.service.spec.ts`
- `test/unit/credit/credit-product-eligibility.spec.ts`
- `test/unit/credit/credit.controllers.spec.ts`
- `test/unit/credit/credit.repository.spec.ts`
- `test/unit/workflow-catalog/customer-credit-workflow.seed-data.spec.ts`

## Referencias al código

- Módulo: [`src/modules/credit/credit.module.ts`](../../../../src/modules/credit/credit.module.ts)
- Controller `CreditOperationsController`: [`src/modules/credit/credit-operations.controller.ts`](../../../../src/modules/credit/credit-operations.controller.ts)
- Controller `CreditController`: [`src/modules/credit/credit.controller.ts`](../../../../src/modules/credit/credit.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
