---
title: "API — schema-management"
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
  - "tag/schema-management"
source_files:
  - "src/modules/schema-management/schema-management.controller.ts"
endpoints:
  - "GET /operations/schema/versions"
  - "GET /operations/schema/versions/:versionId"
  - "GET /operations/schema/tables"
  - "GET /operations/schema/tables/:tableId"
  - "POST /operations/schema/tables"
  - "GET /operations/schema/change-log"
  - "PATCH /operations/schema/change-log/:changeId/approve"
---
# API — `schema-management`

7 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/operations/schema/versions` | 🔒 JWT | `internal_operator`<br>`admin`<br>`platform_admin`<br>`risk_analyst`<br>`readonly_auditor` | — | 200 | Listar versiones de esquema (catálogo DDL) |
| `GET` | `/operations/schema/versions/:versionId` | 🔒 JWT | `internal_operator`<br>`admin`<br>`platform_admin`<br>`risk_analyst`<br>`readonly_auditor` | — | 200, 404 | Obtener una versión de esquema |
| `GET` | `/operations/schema/tables` | 🔒 JWT | `internal_operator`<br>`admin`<br>`platform_admin`<br>`risk_analyst`<br>`readonly_auditor` | — | 200 | Listar tablas del catálogo de esquema |
| `GET` | `/operations/schema/tables/:tableId` | 🔒 JWT | `internal_operator`<br>`admin`<br>`platform_admin`<br>`risk_analyst`<br>`readonly_auditor` | — | 200, 404 | Obtener una tabla del catálogo de esquema (con columnas y FKs) |
| `POST` | `/operations/schema/tables` | 🔒 JWT | `internal_operator`<br>`admin`<br>`platform_admin` | — | 201 | Proponer una tabla nueva (solo-catálogo, no ejecuta DDL) |
| `GET` | `/operations/schema/change-log` | 🔒 JWT | `internal_operator`<br>`admin`<br>`platform_admin`<br>`risk_analyst`<br>`readonly_auditor` | — | 200 | Listar el change-log de propuestas de esquema |
| `PATCH` | `/operations/schema/change-log/:changeId/approve` | 🔒 JWT | `platform_admin` | — | 200, 404, 409 | Aprobar o rechazar una propuesta de cambio de esquema |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/schema-management/schema-management.controller.ts`](../../../../../src/modules/schema-management/schema-management.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
