---
title: "API — operations"
type: "api"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/operations"
source_files:
  - "src/modules/operations/operations.controller.ts"
endpoints:
  - "GET /operations/work-queue"
  - "GET /operations/manual-review-cases"
  - "GET /operations/fraud-cases"
  - "GET /operations/customers/:customerId/investigation-summary"
  - "POST /operations/manual-review-cases/:caseId/decision"
  - "POST /operations/fraud-cases/:caseId/decision"
---
# API — `operations`

6 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/operations/work-queue` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Cola de trabajo combinada (revisión manual + fraude) |
| `GET` | `/operations/manual-review-cases` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Cola de revisión manual (paginada por cursor) |
| `GET` | `/operations/fraud-cases` | 🔒 JWT | `fraud_analyst`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Cola de casos de fraude (paginada por cursor) |
| `GET` | `/operations/customers/:customerId/investigation-summary` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404 | Resumen de investigación de un cliente |
| `POST` | `/operations/manual-review-cases/:caseId/decision` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404, 409, 422 | Decidir un caso de revisión manual |
| `POST` | `/operations/fraud-cases/:caseId/decision` | 🔒 JWT | `fraud_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404, 409 | Decidir un caso de fraude |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/operations/operations.controller.ts`](../../../../src/modules/operations/operations.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
