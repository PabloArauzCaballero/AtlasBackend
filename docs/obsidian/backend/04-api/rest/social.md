---
title: "API — social"
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
  - "tag/social"
source_files:
  - "src/modules/external-data/controllers/social-trust.controller.ts"
endpoints:
  - "GET /social/facebook/connect-url"
  - "POST /social/facebook/callback"
  - "GET /social/facebook/status/:customerId"
---
# API — `social`

3 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/social/facebook/connect-url` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Generar URL de conexión OAuth con Facebook |
| `POST` | `/social/facebook/callback` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Callback OAuth de Facebook |
| `GET` | `/social/facebook/status/:customerId` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Estado de conexión/verificación de Facebook de un cliente |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/external-data/controllers/social-trust.controller.ts`](../../../../../src/modules/external-data/controllers/social-trust.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
