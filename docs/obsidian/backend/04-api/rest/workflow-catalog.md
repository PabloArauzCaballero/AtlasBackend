---
title: "API — workflow-catalog"
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
  - "tag/workflow-catalog"
source_files:
  - "src/modules/workflow-catalog/workflow-catalog.controller.ts"
  - "src/modules/workflow-catalog/workflow-operations.controller.ts"
  - "src/modules/workflow-catalog/workflow-progress.controller.ts"
endpoints:
  - "GET /workflows"
  - "GET /workflows/:workflowCode/versions"
  - "GET /workflows/:workflowCode"
  - "GET /workflows/:workflowCode/stages"
  - "GET /workflows/:workflowCode/transitions"
  - "GET /workflows/:workflowCode/graph"
  - "POST /workflows/:workflowCode/transitions/validate"
  - "GET /operations/workflows/:workflowCode/consistency"
  - "GET /customers/:customerId/workflow-progress"
---
# API — `workflow-catalog`

9 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 3 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/workflows` | 🔒 JWT | `...WORKFLOW_CATALOG_READ_ROLES` | — | 200 | Listar los flujos de trabajo registrados |
| `GET` | `/workflows/:workflowCode/versions` | 🔒 JWT | `...WORKFLOW_CATALOG_READ_ROLES` | — | 200, 404 | Versiones registradas de un flujo |
| `GET` | `/workflows/:workflowCode` | 🔒 JWT | `...WORKFLOW_CATALOG_READ_ROLES` | — | 200, 404 | Árbol completo de un flujo |
| `GET` | `/workflows/:workflowCode/stages` | 🔒 JWT | `...WORKFLOW_CATALOG_READ_ROLES` | — | 200 | Etapas del flujo en orden de ejecución |
| `GET` | `/workflows/:workflowCode/transitions` | 🔒 JWT | `...WORKFLOW_CATALOG_READ_ROLES` | — | 200 | Transiciones declaradas del flujo |
| `GET` | `/workflows/:workflowCode/graph` | 🔒 JWT | `...WORKFLOW_CATALOG_READ_ROLES` | — | 200 | Representación de grafo para visualización |
| `POST` | `/workflows/:workflowCode/transitions/validate` | 🔒 JWT | `...WORKFLOW_CATALOG_READ_ROLES` | — | 200, 404 | Validar si una transición está permitida |
| `GET` | `/operations/workflows/:workflowCode/consistency` | 🔒 JWT | `...WORKFLOW_CATALOG_GOVERNANCE_ROLES` | — | 200, 404 | Informe de consistencia del flujo contra los endpoints reales |
| `GET` | `/customers/:customerId/workflow-progress` | 🔒 JWT | `...WORKFLOW_PROGRESS_ROLES` | — | 200, 403, 404 | Avance del cliente dentro del flujo estándar |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/workflow-catalog/workflow-catalog.controller.ts`](../../../../../src/modules/workflow-catalog/workflow-catalog.controller.ts)
- [`src/modules/workflow-catalog/workflow-operations.controller.ts`](../../../../../src/modules/workflow-catalog/workflow-operations.controller.ts)
- [`src/modules/workflow-catalog/workflow-progress.controller.ts`](../../../../../src/modules/workflow-catalog/workflow-progress.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
