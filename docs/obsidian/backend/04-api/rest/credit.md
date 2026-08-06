---
title: "API — credit"
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
  - "tag/credit"
source_files:
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
---
# API — `credit`

8 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 2 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/operations/credit/products` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Listar los productos vigentes (operaciones) |
| `POST` | `/operations/credit/products` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 201, 409 | Crear un producto crediticio |
| `PATCH` | `/operations/credit/products/:productId/status` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404 | Cambiar el estado de un producto (activar, suspender, retirar) |
| `POST` | `/operations/credit/applications/:applicationId/decision` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404, 409 | Decidir una solicitud de crédito |
| `GET` | `/operations/credit/applications/:applicationId` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Detalle de una solicitud, con su historial completo |
| `GET` | `/customers/:customerId/credit-products` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Productos crediticios disponibles |
| `POST` | `/customers/:customerId/credit-applications` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 201, 404, 409, 422 | Crear una solicitud de crédito |
| `GET` | `/customers/:customerId/credit-applications` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Listar las solicitudes del cliente |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/credit/credit-operations.controller.ts`](../../../../src/modules/credit/credit-operations.controller.ts)
- [`src/modules/credit/credit.controller.ts`](../../../../src/modules/credit/credit.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
