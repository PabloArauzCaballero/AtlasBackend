---
title: "API — audit"
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
  - "tag/audit"
source_files:
  - "src/modules/audit/audit.controller.ts"
endpoints:
  - "GET /operations/audit/customer/:customerId"
  - "GET /operations/audit/customer/:customerId/feed"
---
# API — `audit`

2 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/operations/audit/customer/:customerId` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Historial de auditoría de un cliente (paginado por offset) — DEPRECADO |
| `GET` | `/operations/audit/customer/:customerId/feed` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Historial de auditoría de un cliente (paginado por cursor real) |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/audit/audit.controller.ts`](../../../../src/modules/audit/audit.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
