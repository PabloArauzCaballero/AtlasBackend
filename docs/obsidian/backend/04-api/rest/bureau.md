---
title: "API — bureau"
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
  - "tag/bureau"
source_files:
  - "src/modules/external-data/controllers/kyc-bureau.controller.ts"
endpoints:
  - "POST /bureau/infocenter/check"
---
# API — `bureau`

1 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/bureau/infocenter/check` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200, 422 | Consultar buró de crédito InfoCenter |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/external-data/controllers/kyc-bureau.controller.ts`](../../../../../src/modules/external-data/controllers/kyc-bureau.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
