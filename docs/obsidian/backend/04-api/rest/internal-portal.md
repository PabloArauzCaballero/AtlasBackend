---
title: "API — internal-portal"
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
  - "tag/internal-portal"
source_files:
  - "src/modules/internal-portal/internal-portal.controller.ts"
endpoints:
  - "GET /internal/business-metadata/glossary"
  - "GET /internal/business-metadata/terms/:termId"
  - "GET /internal/exports"
  - "GET /internal/exports/:exportId"
  - "GET /internal/data-quality/rules"
  - "GET /internal/data-quality/rules/:ruleId"
  - "POST /internal/data-quality/rules/:ruleId/run"
  - "GET /internal/governance/policies/:policyId"
  - "PATCH /internal/governance/policies/:policyId"
  - "GET /internal/lineage"
  - "GET /internal/lineage/nodes/:nodeId"
  - "GET /internal/lineage/impact"
  - "GET /internal/alerts"
  - "POST /internal/alerts/:alertId/acknowledge"
  - "GET /internal/jobs"
  - "GET /internal/jobs/:jobRunId"
  - "POST /internal/jobs/:jobRunId/retry"
  - "POST /internal/jobs/:jobRunId/cancel"
  - "GET /internal/release-readiness"
  - "GET /internal/reports"
  - "GET /internal/reports/:reportId"
  - "POST /internal/reports/:reportId/run"
  - "GET /internal/reports/:reportId/snapshots"
  - "GET /internal/search"
---
# API — `internal-portal`

24 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/internal/business-metadata/glossary` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Listar términos del glosario de negocio |
| `GET` | `/internal/business-metadata/terms/:termId` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200, 404 | Obtener un término del glosario de negocio |
| `GET` | `/internal/exports` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Listar exports registrados |
| `GET` | `/internal/exports/:exportId` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Obtener un export registrado |
| `GET` | `/internal/data-quality/rules` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Listar reglas de calidad de datos |
| `GET` | `/internal/data-quality/rules/:ruleId` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Obtener una regla de calidad de datos |
| `POST` | `/internal/data-quality/rules/:ruleId/run` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Ejecutar una regla de calidad de datos bajo demanda |
| `GET` | `/internal/governance/policies/:policyId` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Obtener una política de gobierno de datos |
| `PATCH` | `/internal/governance/policies/:policyId` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Actualizar una política de gobierno de datos |
| `GET` | `/internal/lineage` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Consultar el grafo de linaje de datos |
| `GET` | `/internal/lineage/nodes/:nodeId` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Obtener un nodo de linaje de datos |
| `GET` | `/internal/lineage/impact` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Analizar impacto de linaje de datos (aguas abajo/arriba) |
| `GET` | `/internal/alerts` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Listar alertas del panel interno |
| `POST` | `/internal/alerts/:alertId/acknowledge` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Reconocer (acknowledge) una alerta |
| `GET` | `/internal/jobs` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Listar corridas de jobs |
| `GET` | `/internal/jobs/:jobRunId` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Obtener una corrida de job |
| `POST` | `/internal/jobs/:jobRunId/retry` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Reintentar una corrida de job |
| `POST` | `/internal/jobs/:jobRunId/cancel` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Cancelar una corrida de job |
| `GET` | `/internal/release-readiness` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Resumen de disponibilidad para release (release readiness) |
| `GET` | `/internal/reports` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Listar reportes registrados |
| `GET` | `/internal/reports/:reportId` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Obtener un reporte registrado |
| `POST` | `/internal/reports/:reportId/run` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Ejecutar un reporte bajo demanda |
| `GET` | `/internal/reports/:reportId/snapshots` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Listar snapshots históricos de un reporte |
| `GET` | `/internal/search` | 🔒 JWT | `...INTERNAL_PORTAL_ROLES` | — | 200 | Búsqueda global dentro del panel interno |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/internal-portal/internal-portal.controller.ts`](../../../../src/modules/internal-portal/internal-portal.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
