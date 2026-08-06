---
title: "operations"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "operations"
module: "OperationsModule"
tags:
  - "backend"
  - "domain"
  - "module/operations"
source_files:
  - "src/modules/operations/operations.module.ts"
  - "src/modules/operations/operations.controller.ts"
endpoints:
  - "GET /operations/work-queue"
  - "GET /operations/manual-review-cases"
  - "GET /operations/fraud-cases"
  - "GET /operations/customers/:customerId/investigation-summary"
  - "POST /operations/manual-review-cases/:caseId/decision"
  - "POST /operations/fraud-cases/:caseId/decision"
dependencies:
  - "CustomersModule"
  - "RiskModule"
  - "FraudModule"
---
# Módulo `operations`

Esta pieza permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.

**Papel técnico:** gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.

| | |
|---|---|
| Clase | `OperationsModule` |
| Archivos | 7 |
| Controllers | 1 |
| Rutas HTTP | 6 |
| Modelos usados | 7 |
| Esquemas de datos | [[catalog-schema\|catalog]], [[customer-schema\|customer]], [[audit-schema\|audit]], [[case_management-schema\|case_management]] |

## Entradas

6 rutas HTTP. Contrato completo en [[04-api/rest/operations\|operations]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/operations/work-queue` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` |
| `GET` | `/operations/manual-review-cases` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` |
| `GET` | `/operations/fraud-cases` | 🔒 | `fraud_analyst` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/operations/customers/:customerId/investigation-summary` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` |
| `POST` | `/operations/manual-review-cases/:caseId/decision` | 🔒 | `internal_operator` `risk_analyst` `admin` `platform_admin` |
| `POST` | `/operations/fraud-cases/:caseId/decision` | 🔒 | `fraud_analyst` `admin` `platform_admin` |

## Salidas y efectos

Persiste en 7 tabla(s):

- [[customer_observations]] (`catalog`)
- [[customer_status_events]] (`customer`)
- [[data_change_logs]] (`audit`)
- [[fraud_cases]] (`case_management`)
- [[manual_review_cases]] (`case_management`)
- [[manual_review_events]] (`case_management`)
- [[operational_audit_logs]] (`audit`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]], [[03-domains/risk/index\|risk]], [[03-domains/fraud/index\|fraud]]

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `operations.controller.ts` |
| Services | `operations.service.ts` |
| Repositories | `operations.repository.ts` |
| Esquemas Zod | `operations.schemas.ts` |
| Mappers | `operations.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `fraud_analyst`.


## Pruebas

5 archivo(s) de test:

- `test/e2e/workflow-catalog/workflow-progress-and-operations.spec.ts`
- `test/unit/operations/operations.controller.spec.ts`
- `test/unit/operations/operations.mapper.spec.ts`
- `test/unit/operations/operations.repository.spec.ts`
- `test/unit/operations/operations.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/operations/operations.module.ts`](../../../../src/modules/operations/operations.module.ts)
- Controller `OperationsController`: [`src/modules/operations/operations.controller.ts`](../../../../src/modules/operations/operations.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
