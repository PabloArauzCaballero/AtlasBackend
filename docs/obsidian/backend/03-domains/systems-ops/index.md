---
title: "systems-ops"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "systems-ops"
module: "SystemsOpsModule"
tags:
  - "backend"
  - "domain"
  - "module/systems-ops"
source_files:
  - "src/modules/systems-ops/systems-ops.module.ts"
  - "src/modules/systems-ops/systems-action-log.controller.ts"
  - "src/modules/systems-ops/systems-catalog.controller.ts"
  - "src/modules/systems-ops/systems-review.controller.ts"
  - "src/modules/systems-ops/systems-stress.controller.ts"
  - "src/modules/systems-ops/systems-test.controller.ts"
endpoints:
  - "GET /systems/action-logs"
  - "GET /systems/action-logs/request/:requestId"
  - "GET /systems/action-logs/by-request/:requestId"
  - "GET /systems/reports/traffic-latency"
  - "GET /systems/reports/traffic-latency-timeseries"
  - "GET /systems/dashboard"
  - "GET /systems/endpoints"
  - "GET /systems/endpoints/:endpointId"
  - "POST /systems/endpoints/discover"
  - "POST /systems/endpoints/catalog-seed/refresh"
  - "GET /systems/tools"
  - "GET /systems/tools/:toolId"
  - "POST /systems/tools/infer-requirements"
  - "POST /systems/data-entities/infer-impacts"
  - "GET /systems/data-entities"
  - "GET /systems/domains"
  - "GET /systems/domains/:domainCode"
  - "GET /systems/data-entities/:entityId"
  - "PATCH /systems/data-entities/:entityId/metadata"
  - "GET /systems/impact/by-endpoint/:endpointId"
  - "GET /systems/impact/by-table/:schemaName/:tableName"
  - "GET /systems/health/tools"
  - "GET /systems/review-queue"
  - "PATCH /systems/endpoints/:endpointId/review"
  - "PATCH /systems/tools/requirements/:requirementId/review"
  - "PATCH /systems/data-entities/:entityId/review"
  - "PATCH /systems/impact/data/:impactId/review"
  - "PATCH /systems/impact/fields/:fieldImpactId/review"
  - "PATCH /systems/data-entities/columns/:columnId/review"
  - "GET /systems/stress-profiles"
  - "GET /systems/stress-profiles/:profileId"
  - "POST /systems/stress-profiles/:profileId/queue-run"
  - "POST /systems/stress-profiles"
  - "GET /systems/stress-matrix"
  - "GET /systems/stress-runs"
  - "POST /systems/test-suites"
  - "GET /systems/test-suites"
  - "GET /systems/test-suites/:suiteId"
  - "PATCH /systems/test-suites/:suiteId"
  - "POST /systems/test-suites/:suiteId/steps"
  - "PATCH /systems/test-suites/:suiteId/steps/:stepId"
  - "POST /systems/test-suites/:suiteId/steps/reorder"
  - "POST /systems/test-suites/:suiteId/run"
  - "GET /systems/test-runs"
  - "GET /systems/test-runs/:runId"
dependencies:
  - "NotificationsModule"
---
# Módulo `systems-ops`

Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.

**Papel técnico:** descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.

| | |
|---|---|
| Clase | `SystemsOpsModule` |
| Archivos | 66 |
| Controllers | 5 |
| Rutas HTTP | 45 |
| Modelos usados | 18 |
| Esquemas de datos | [[platform_ops-schema\|platform_ops]] |

## Entradas

45 rutas HTTP. Contrato completo en [[04-api/index]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/systems/action-logs` | 🔒 | — |
| `GET` | `/systems/action-logs/request/:requestId` | 🔒 | — |
| `GET` | `/systems/action-logs/by-request/:requestId` | 🔒 | — |
| `GET` | `/systems/reports/traffic-latency` | 🔒 | — |
| `GET` | `/systems/reports/traffic-latency-timeseries` | 🔒 | — |
| `GET` | `/systems/dashboard` | 🔒 | — |
| `GET` | `/systems/endpoints` | 🔒 | — |
| `GET` | `/systems/endpoints/:endpointId` | 🔒 | — |
| `POST` | `/systems/endpoints/discover` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `POST` | `/systems/endpoints/catalog-seed/refresh` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `GET` | `/systems/tools` | 🔒 | — |
| `GET` | `/systems/tools/:toolId` | 🔒 | — |
| `POST` | `/systems/tools/infer-requirements` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `POST` | `/systems/data-entities/infer-impacts` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `GET` | `/systems/data-entities` | 🔒 | — |
| `GET` | `/systems/domains` | 🔒 | — |
| `GET` | `/systems/domains/:domainCode` | 🔒 | — |
| `GET` | `/systems/data-entities/:entityId` | 🔒 | — |
| `PATCH` | `/systems/data-entities/:entityId/metadata` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `GET` | `/systems/impact/by-endpoint/:endpointId` | 🔒 | — |
| `GET` | `/systems/impact/by-table/:schemaName/:tableName` | 🔒 | — |
| `GET` | `/systems/health/tools` | 🔒 | — |
| `GET` | `/systems/review-queue` | 🔒 | — |
| `PATCH` | `/systems/endpoints/:endpointId/review` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `PATCH` | `/systems/tools/requirements/:requirementId/review` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `PATCH` | `/systems/data-entities/:entityId/review` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `PATCH` | `/systems/impact/data/:impactId/review` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `PATCH` | `/systems/impact/fields/:fieldImpactId/review` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `PATCH` | `/systems/data-entities/columns/:columnId/review` | 🔒 | `...SYSTEMS_OPS_GOVERNANCE_ROLES` |
| `GET` | `/systems/stress-profiles` | 🔒 | — |
| `GET` | `/systems/stress-profiles/:profileId` | 🔒 | — |
| `POST` | `/systems/stress-profiles/:profileId/queue-run` | 🔒 | `...SYSTEMS_OPS_STRESS_ROLES` |
| `POST` | `/systems/stress-profiles` | 🔒 | `...SYSTEMS_OPS_STRESS_ROLES` |
| `GET` | `/systems/stress-matrix` | 🔒 | — |
| `GET` | `/systems/stress-runs` | 🔒 | — |
| `POST` | `/systems/test-suites` | 🔒 | `...SYSTEMS_OPS_QA_ROLES` |
| `GET` | `/systems/test-suites` | 🔒 | — |
| `GET` | `/systems/test-suites/:suiteId` | 🔒 | — |
| `PATCH` | `/systems/test-suites/:suiteId` | 🔒 | `...SYSTEMS_OPS_QA_ROLES` |
| `POST` | `/systems/test-suites/:suiteId/steps` | 🔒 | `...SYSTEMS_OPS_QA_ROLES` |

… y 5 más. Ver [[15-reference/endpoint-catalog]].

## Salidas y efectos

Persiste en 18 tabla(s):

- [[system_action_logs]] (`platform_ops`)
- [[system_job_runs]] (`platform_ops`)
- [[system_stress_profiles]] (`platform_ops`)
- [[system_endpoint_catalog]] (`platform_ops`)
- [[system_endpoint_data_entity_impacts]] (`platform_ops`)
- [[system_endpoint_field_impacts]] (`platform_ops`)
- [[system_endpoint_tool_requirements]] (`platform_ops`)
- [[system_test_runs]] (`platform_ops`)
- [[system_test_steps]] (`platform_ops`)
- [[system_test_step_runs]] (`platform_ops`)
- [[system_test_suites]] (`platform_ops`)
- [[system_tool_catalog]] (`platform_ops`)
- [[system_domain_catalog]] (`platform_ops`)
- [[system_endpoint_payload_contracts]] (`platform_ops`)
- [[system_data_field_catalog]] (`platform_ops`)
- [[system_data_relationship_catalog]] (`platform_ops`)
- [[system_operational_rule_catalog]] (`platform_ops`)
- [[system_catalog_review_events]] (`platform_ops`)

## Dependencias

**Depende de:** [[03-domains/notifications/index\|notifications]]

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `systems-action-log.controller.ts`, `systems-catalog.controller.ts`, `systems-review.controller.ts`, `systems-stress.controller.ts`, `systems-test.controller.ts` |
| Services | `endpoint-discovery.service.ts`, `systems-action-log-query.service.ts`, `systems-catalog-classifier.service.ts`, `systems-catalog-query.service.ts`, `systems-catalog-seed.service.ts`, `systems-data-impact-inference.service.ts`, `systems-health-monitor.service.ts`, `systems-health.service.ts`, `systems-review.service.ts`, `systems-stress-profile.service.ts`, `systems-stress-run.service.ts`, `systems-test-assertion.service.ts`, `systems-test-http-client.service.ts`, `systems-test-query.service.ts`, `systems-test-runner.service.ts`, `systems-test-suite-admin.service.ts`, `systems-test-template.service.ts`, `systems-tool-inference.service.ts` |
| Repositories | `systems-action-log.repository.ts`, `systems-catalog.repository.ts`, `systems-dashboard.repository.ts`, `systems-data-impact-inference.repository.ts`, `systems-review.repository.ts`, `systems-stress-profile.repository.ts`, `systems-test-execution.repository.ts`, `systems-test-suite-admin.repository.ts`, `systems-tool-inference.repository.ts` |
| Esquemas Zod | `systems-ops.schemas.ts` |
| Mappers | `systems-entity-narrative.mapper.ts`, `systems-ops.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `...SYSTEMS_OPS_GOVERNANCE_ROLES`, `...SYSTEMS_OPS_STRESS_ROLES`, `...SYSTEMS_OPS_QA_ROLES`.


## Pruebas

47 archivo(s) de test:

- `test/e2e/systems-ops/action-log.spec.ts`
- `test/e2e/systems-ops/catalog.spec.ts`
- `test/e2e/systems-ops/review.spec.ts`
- `test/e2e/systems-ops/stress.spec.ts`
- `test/e2e/systems-ops/test-suites.spec.ts`
- `test/unit/openapi/systems-ops-openapi.spec.ts`
- `test/unit/systems-ops-catalog-repository-deprecation.spec.ts`
- `test/unit/systems-ops-endpoint-discovery-persist.spec.ts`
- `test/unit/systems-ops-endpoint-discovery-security.spec.ts`
- `test/unit/systems-ops-endpoint.util.spec.ts`
- `test/unit/systems-ops-suite-admin.spec.ts`
- `test/unit/systems-ops-tenant-scope.spec.ts`
- `test/unit/systems-ops-test-runner-ssrf.spec.ts`
- `test/unit/systems-ops-test-runner-utils.spec.ts`
- `test/unit/systems-ops-url-policy.spec.ts`
- … y 32 más

## Referencias al código

- Módulo: [`src/modules/systems-ops/systems-ops.module.ts`](../../../../src/modules/systems-ops/systems-ops.module.ts)
- Controller `SystemsActionLogController`: [`src/modules/systems-ops/systems-action-log.controller.ts`](../../../../src/modules/systems-ops/systems-action-log.controller.ts)
- Controller `SystemsCatalogController`: [`src/modules/systems-ops/systems-catalog.controller.ts`](../../../../src/modules/systems-ops/systems-catalog.controller.ts)
- Controller `SystemsReviewController`: [`src/modules/systems-ops/systems-review.controller.ts`](../../../../src/modules/systems-ops/systems-review.controller.ts)
- Controller `SystemsStressController`: [`src/modules/systems-ops/systems-stress.controller.ts`](../../../../src/modules/systems-ops/systems-stress.controller.ts)
- Controller `SystemsTestController`: [`src/modules/systems-ops/systems-test.controller.ts`](../../../../src/modules/systems-ops/systems-test.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
