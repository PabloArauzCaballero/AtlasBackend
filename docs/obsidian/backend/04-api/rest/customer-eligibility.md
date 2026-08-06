---
title: "API — customer-eligibility"
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
  - "tag/customer-eligibility"
source_files:
  - "src/modules/customers/customer-eligibility.controller.ts"
endpoints:
  - "GET /customers/:customerId/eligibility"
  - "POST /operations/customers/:customerId/eligibility/decision"
---
# API — `customer-eligibility`

2 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/customers/:customerId/eligibility` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin` | — | 200, 403, 404 | Habilitación crediticia del cliente |
| `POST` | `/operations/customers/:customerId/eligibility/decision` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404, 422 | Decidir la habilitación de un cliente (operaciones) |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/customers/customer-eligibility.controller.ts`](../../../../src/modules/customers/customer-eligibility.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
