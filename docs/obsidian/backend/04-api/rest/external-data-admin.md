---
title: "API — external-data-admin"
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
  - "tag/external-data-admin"
source_files:
  - "src/modules/external-data/external-data.controller.ts"
endpoints:
  - "GET /admin/external-providers"
  - "GET /admin/external-providers/health"
  - "GET /admin/external-providers/readiness"
  - "GET /admin/external-providers/quality-audit"
  - "GET /admin/external-providers/production-gate"
  - "GET /admin/external-providers/sla"
  - "GET /admin/external-providers/usage"
  - "GET /admin/external-providers/idempotency-audit"
  - "GET /admin/external-providers/retention/preview"
  - "GET /admin/external-providers/sanitization-audit"
  - "POST /admin/external-providers/policy/preview"
  - "PATCH /admin/external-providers/:providerCode/runtime"
  - "POST /admin/external-providers/:providerCode/kill-switch"
  - "GET /admin/external-providers/:providerCode/cost-policy"
  - "PATCH /admin/external-providers/:providerCode/cost-policy/:queryType"
  - "POST /admin/external-providers/:providerCode/test"
  - "POST /admin/external-providers/requests/:requestId/approve"
  - "POST /admin/external-providers/requests/:requestId/retry"
  - "POST /admin/external-providers/requests/:requestId/rebuild-features"
---
# API — `external-data-admin`

19 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/admin/external-providers` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Listar catálogo de proveedores externos |
| `GET` | `/admin/external-providers/health` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Salud de todos los proveedores externos |
| `GET` | `/admin/external-providers/readiness` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Readiness de proveedores para producción |
| `GET` | `/admin/external-providers/quality-audit` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Auditoría de calidad de configuración de proveedores |
| `GET` | `/admin/external-providers/production-gate` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Gate de producción por proveedor |
| `GET` | `/admin/external-providers/sla` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Reporte de SLA por proveedor (latencia, tasa de éxito) |
| `GET` | `/admin/external-providers/usage` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Uso/costo acumulado por proveedor |
| `GET` | `/admin/external-providers/idempotency-audit` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Auditoría de claves de idempotencia de solicitudes a proveedores |
| `GET` | `/admin/external-providers/retention/preview` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Vista previa de purga por retención |
| `GET` | `/admin/external-providers/sanitization-audit` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Auditoría de sanitización de respuestas |
| `POST` | `/admin/external-providers/policy/preview` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Vista previa de política (alias administrativo de requests/preview) |
| `PATCH` | `/admin/external-providers/:providerCode/runtime` | 🔒 JWT | `admin`<br>`platform_admin` | — | 200, 403 | Reconfigurar modo/estado runtime de un proveedor (solo admin) |
| `POST` | `/admin/external-providers/:providerCode/kill-switch` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Kill switch de emergencia de un proveedor |
| `GET` | `/admin/external-providers/:providerCode/cost-policy` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Listar políticas de costo de un proveedor (por tipo de consulta) |
| `PATCH` | `/admin/external-providers/:providerCode/cost-policy/:queryType` | 🔒 JWT | `admin`<br>`platform_admin` | — | 200, 403 | Editar política de costo/aprobación de un proveedor (solo admin) |
| `POST` | `/admin/external-providers/:providerCode/test` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200 | Probar un proveedor con datos sintéticos |
| `POST` | `/admin/external-providers/requests/:requestId/approve` | 🔒 JWT | `admin`<br>`platform_admin` | — | 200, 403, 404 | Aprobar solicitud costosa/manual (solo admin) |
| `POST` | `/admin/external-providers/requests/:requestId/retry` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200, 404 | Reintentar una solicitud fallida a proveedor externo |
| `POST` | `/admin/external-providers/requests/:requestId/rebuild-features` | 🔒 JWT | `admin`<br>`platform_admin`<br>`risk_analyst`<br>`compliance_analyst` | — | 200, 404 | Reconstruir snapshot de features desde una respuesta existente |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/external-data/external-data.controller.ts`](../../../../src/modules/external-data/external-data.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
