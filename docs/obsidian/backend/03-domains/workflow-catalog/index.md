---
title: "workflow-catalog"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "workflow-catalog"
module: "WorkflowCatalogModule"
tags:
  - "backend"
  - "domain"
  - "module/workflow-catalog"
source_files:
  - "src/modules/workflow-catalog/workflow-catalog.module.ts"
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
dependencies:
  - "DiscoveryModule"
  - "CustomersModule"
---
# Módulo `workflow-catalog`

Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.

**Papel técnico:** expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.

| | |
|---|---|
| Clase | `WorkflowCatalogModule` |
| Archivos | 18 |
| Controllers | 3 |
| Rutas HTTP | 9 |
| Modelos usados | 6 |
| Esquemas de datos | [[platform_ops-schema\|platform_ops]] |

## Entradas

9 rutas HTTP. Contrato completo en [[04-api/rest/workflow-catalog\|workflow-catalog]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/workflows` | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` |
| `GET` | `/workflows/:workflowCode/versions` | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` |
| `GET` | `/workflows/:workflowCode` | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` |
| `GET` | `/workflows/:workflowCode/stages` | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` |
| `GET` | `/workflows/:workflowCode/transitions` | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` |
| `GET` | `/workflows/:workflowCode/graph` | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` |
| `POST` | `/workflows/:workflowCode/transitions/validate` | 🔒 | `...WORKFLOW_CATALOG_READ_ROLES` |
| `GET` | `/operations/workflows/:workflowCode/consistency` | 🔒 | `...WORKFLOW_CATALOG_GOVERNANCE_ROLES` |
| `GET` | `/customers/:customerId/workflow-progress` | 🔒 | `...WORKFLOW_PROGRESS_ROLES` |

## Salidas y efectos

Persiste en 6 tabla(s):

- [[system_endpoint_catalog]] (`platform_ops`)
- [[workflow_definitions]] (`platform_ops`)
- [[workflow_stages]] (`platform_ops`)
- [[workflow_step_dependencies]] (`platform_ops`)
- [[workflow_steps]] (`platform_ops`)
- [[workflow_transitions]] (`platform_ops`)

## Dependencias

**Depende de:** `DiscoveryModule`, [[03-domains/customers/index\|customers]]

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** `WorkflowCatalogService`

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `workflow-catalog.controller.ts`, `workflow-operations.controller.ts`, `workflow-progress.controller.ts` |
| Services | `workflow-catalog.service.ts`, `application/exposed-route-scanner.service.ts`, `application/workflow-consistency.service.ts`, `application/workflow-progress.service.ts`, `application/workflow-transition.service.ts` |
| Repositories | `workflow-catalog.repository.ts` |
| Esquemas Zod | `workflow-catalog.schemas.ts` |
| Mappers | `workflow-catalog.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `...WORKFLOW_CATALOG_READ_ROLES`, `...WORKFLOW_CATALOG_GOVERNANCE_ROLES`, `...WORKFLOW_PROGRESS_ROLES`.


## Pruebas

15 archivo(s) de test:

- `test/e2e/workflow-catalog/workflow-catalog.spec.ts`
- `test/e2e/workflow-catalog/workflow-progress-and-operations.spec.ts`
- `test/unit/workflow-catalog/customer-credit-workflow.seed-data.spec.ts`
- `test/unit/workflow-catalog/exposed-route-scanner.service.spec.ts`
- `test/unit/workflow-catalog/workflow-bundle-filter.util.spec.ts`
- `test/unit/workflow-catalog/workflow-catalog.mapper.spec.ts`
- `test/unit/workflow-catalog/workflow-catalog.repository.spec.ts`
- `test/unit/workflow-catalog/workflow-catalog.service.spec.ts`
- `test/unit/workflow-catalog/workflow-completion-rule.util.spec.ts`
- `test/unit/workflow-catalog/workflow-consistency.service.spec.ts`
- `test/unit/workflow-catalog/workflow-graph.builder.spec.ts`
- `test/unit/workflow-catalog/workflow-progress.service.spec.ts`
- `test/unit/workflow-catalog/workflow-seeder.spec.ts`
- `test/unit/workflow-catalog/workflow-stage-order.util.spec.ts`
- `test/unit/workflow-catalog/workflow-transition.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/workflow-catalog/workflow-catalog.module.ts`](../../../../src/modules/workflow-catalog/workflow-catalog.module.ts)
- Controller `WorkflowCatalogController`: [`src/modules/workflow-catalog/workflow-catalog.controller.ts`](../../../../src/modules/workflow-catalog/workflow-catalog.controller.ts)
- Controller `WorkflowOperationsController`: [`src/modules/workflow-catalog/workflow-operations.controller.ts`](../../../../src/modules/workflow-catalog/workflow-operations.controller.ts)
- Controller `WorkflowProgressController`: [`src/modules/workflow-catalog/workflow-progress.controller.ts`](../../../../src/modules/workflow-catalog/workflow-progress.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
