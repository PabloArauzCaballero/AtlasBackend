---
title: "API — customer-privacy"
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
  - "tag/customer-privacy"
source_files:
  - "src/modules/customer-privacy/customer-privacy.controller.ts"
endpoints:
  - "POST /customers/:customerId/privacy/consent-decisions"
  - "POST /customers/:customerId/privacy/data-subject-requests"
---
# API — `customer-privacy`

2 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/customers/:customerId/privacy/consent-decisions` | 🔒 JWT | `customer`<br>`internal_operator`<br>`compliance_analyst`<br>`admin`<br>`platform_admin` | — | 200, 400, 403, 404, 422 | Registrar decisiones de consentimiento (batch) |
| `POST` | `/customers/:customerId/privacy/data-subject-requests` | 🔒 JWT | `customer`<br>`internal_operator`<br>`compliance_analyst`<br>`admin`<br>`platform_admin` | — | 201, 400, 403, 404 | Crear solicitud de derechos ARCO/GDPR |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/customer-privacy/customer-privacy.controller.ts`](../../../../../src/modules/customer-privacy/customer-privacy.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
