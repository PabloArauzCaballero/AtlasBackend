---
title: "API — internal-access-catalog"
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
  - "tag/internal-access-catalog"
source_files:
  - "src/modules/internal-users/internal-access-catalog.controller.ts"
endpoints:
  - "GET /internal/roles"
  - "GET /internal/roles/:roleId"
  - "GET /internal/permissions"
---
# API — `internal-access-catalog`

3 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/internal/roles` | 🔒 JWT | — | — | 200 | Listar roles internos |
| `GET` | `/internal/roles/:roleId` | 🔒 JWT | — | — | 200, 404 | Consultar rol interno |
| `GET` | `/internal/permissions` | 🔒 JWT | — | — | 200 | Listar permisos internos |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/internal-users/internal-access-catalog.controller.ts`](../../../../src/modules/internal-users/internal-access-catalog.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
