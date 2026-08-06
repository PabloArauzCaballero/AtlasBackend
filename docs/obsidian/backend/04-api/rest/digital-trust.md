---
title: "API — digital-trust"
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
  - "tag/digital-trust"
source_files:
  - "src/modules/external-data/controllers/social-trust.controller.ts"
endpoints:
  - "POST /digital-trust/check"
  - "GET /digital-trust/profile/:customerId"
---
# API — `digital-trust`

2 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/digital-trust/check` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Consultar confianza digital (email/IP/dispositivo) |
| `GET` | `/digital-trust/profile/:customerId` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Perfil de confianza digital de un cliente |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/external-data/controllers/social-trust.controller.ts`](../../../../src/modules/external-data/controllers/social-trust.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
