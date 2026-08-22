---
title: "API — risk"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/risk"
source_files:
  - "src/modules/risk/risk.controller.ts"
endpoints:
  - "POST /customers/:customerId/risk-assessments"
  - "GET /operations/risk-assessments/:riskAssessmentRunId"
  - "GET /operations/risk-assessments/:riskAssessmentRunId/explanation"
---
# API — `risk`

3 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/customers/:customerId/risk-assessments` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`system`<br>`admin`<br>`platform_admin` | — | 201, 400, 404, 422 | Crear evaluación de riesgo |
| `GET` | `/operations/risk-assessments/:riskAssessmentRunId` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404 | Detalle de una evaluación de riesgo (operaciones) |
| `GET` | `/operations/risk-assessments/:riskAssessmentRunId/explanation` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404 | Explicación de una evaluación de riesgo (operaciones) |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/risk/risk.controller.ts`](../../../../../src/modules/risk/risk.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
