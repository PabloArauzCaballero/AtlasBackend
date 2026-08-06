---
title: "API — catalog-management"
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
  - "tag/catalog-management"
source_files:
  - "src/modules/catalog-management/catalog-management.controller.ts"
endpoints:
  - "GET /operations/catalogs"
  - "GET /operations/catalogs/:catalogCode/versions/:versionId"
  - "POST /operations/catalogs/:catalogCode/versions"
  - "POST /operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval"
  - "POST /operations/catalogs/:catalogCode/versions/:versionId/decision"
  - "POST /operations/catalog-ingestions"
  - "POST /operations/catalog-staging-items/decision-batch"
  - "GET /operations/definitions"
  - "POST /operations/definitions/package"
  - "GET /operations/risk-policy/current"
  - "POST /operations/risk-policy/ruleset-versions"
  - "POST /operations/risk-policy/ruleset-versions/:rulesetVersionId/activate"
  - "GET /operations/data-governance/policies"
  - "POST /operations/data-governance/policy-package"
---
# API — `catalog-management`

14 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/operations/catalogs` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Listar catálogos de contexto del motor de decisión |
| `GET` | `/operations/catalogs/:catalogCode/versions/:versionId` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 404 | Obtener una versión de catálogo |
| `POST` | `/operations/catalogs/:catalogCode/versions` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 201, 404 | Crear una nueva versión de catálogo (borrador) |
| `POST` | `/operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 404, 422 | Enviar una versión de catálogo a aprobación |
| `POST` | `/operations/catalogs/:catalogCode/versions/:versionId/decision` | 🔒 JWT | `admin`<br>`platform_admin` | — | 200, 404, 422 | Aprobar o rechazar una versión de catálogo |
| `POST` | `/operations/catalog-ingestions` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 201, 404 | Ingerir un catálogo (staging) |
| `POST` | `/operations/catalog-staging-items/decision-batch` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 404, 422 | Decidir en lote items en staging de catálogo |
| `GET` | `/operations/definitions` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Listar definiciones semánticas del motor de decisión |
| `POST` | `/operations/definitions/package` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Publicar un paquete de definiciones semánticas |
| `GET` | `/operations/risk-policy/current` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Obtener la política de riesgo activa |
| `POST` | `/operations/risk-policy/ruleset-versions` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 201 | Crear una nueva versión de ruleset de riesgo (borrador) |
| `POST` | `/operations/risk-policy/ruleset-versions/:rulesetVersionId/activate` | 🔒 JWT | `admin`<br>`platform_admin` | — | 200, 404 | Activar una versión de ruleset de riesgo |
| `GET` | `/operations/data-governance/policies` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Obtener las políticas de gobernanza de datos activas |
| `POST` | `/operations/data-governance/policy-package` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Publicar un paquete de políticas de gobernanza de datos |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/catalog-management/catalog-management.controller.ts`](../../../../src/modules/catalog-management/catalog-management.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
