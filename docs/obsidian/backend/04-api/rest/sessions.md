---
title: "API — sessions"
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
  - "tag/sessions"
source_files:
  - "src/modules/sessions/sessions.controller.ts"
endpoints:
  - "POST /customers/:customerId/sessions/start"
  - "POST /customers/:customerId/sessions/:sessionId/heartbeat"
  - "POST /customers/:customerId/sessions/:sessionId/end"
  - "GET /customers/:customerId/session-state"
  - "GET /operations/sessions/:sessionId/investigation-summary"
---
# API — `sessions`

5 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/customers/:customerId/sessions/start` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 201, 400, 403, 404, 422 | Iniciar una sesión de cliente |
| `POST` | `/customers/:customerId/sessions/:sessionId/heartbeat` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 202, 403, 404, 422 | Heartbeat de sesión |
| `POST` | `/customers/:customerId/sessions/:sessionId/end` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 403, 404 | Cerrar sesión |
| `GET` | `/customers/:customerId/session-state` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 404 | Estado de sesión actual del cliente |
| `GET` | `/operations/sessions/:sessionId/investigation-summary` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 404 | Resumen de investigación de una sesión (operaciones) |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/sessions/sessions.controller.ts`](../../../../src/modules/sessions/sessions.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
