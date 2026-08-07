---
title: "API — internal-admin-views"
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
  - "tag/internal-admin-views"
source_files:
  - "src/modules/internal-portal/admin-read.controller.ts"
endpoints:
  - "GET /internal/views/customers"
  - "GET /internal/views/risk-assessments"
  - "GET /internal/views/work-queue"
  - "GET /internal/views/provider-health"
  - "GET /internal/views/notification-deliveries"
  - "GET /internal/views/endpoint-coverage"
  - "GET /internal/views/audit-events"
---
# API — `internal-admin-views`

7 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/internal/views/customers` | 🔒 JWT | `...ADMIN_READ_ROLES` | — | — | Vista paginada de clientes con proyección de campos |
| `GET` | `/internal/views/risk-assessments` | 🔒 JWT | `...ADMIN_READ_ROLES` | — | — | Vista paginada de decisiones de riesgo |
| `GET` | `/internal/views/work-queue` | 🔒 JWT | `...ADMIN_READ_ROLES` | — | — | Cola operativa unificada y paginada |
| `GET` | `/internal/views/provider-health` | 🔒 JWT | `...ADMIN_READ_ROLES` | — | — | Último estado de salud por proveedor |
| `GET` | `/internal/views/notification-deliveries` | 🔒 JWT | `...ADMIN_READ_ROLES` | — | — | Resumen paginado de entrega de notificaciones |
| `GET` | `/internal/views/endpoint-coverage` | 🔒 JWT | `...ADMIN_READ_ROLES` | — | — | Cobertura y release readiness por endpoint |
| `GET` | `/internal/views/audit-events` | 🔒 JWT | `...ADMIN_READ_ROLES` | — | — | Feed de auditoría curado y paginado |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/internal-portal/admin-read.controller.ts`](../../../../../src/modules/internal-portal/admin-read.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
