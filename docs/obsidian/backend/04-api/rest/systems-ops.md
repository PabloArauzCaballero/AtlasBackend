---
title: "API — systems-ops"
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
  - "tag/systems-ops"
source_files:
  - "src/modules/log-sync/mongo-logs.controller.ts"
  - "src/modules/systems-ops/systems-action-log.controller.ts"
  - "src/modules/systems-ops/systems-catalog.controller.ts"
  - "src/modules/systems-ops/systems-review.controller.ts"
  - "src/modules/systems-ops/systems-stress.controller.ts"
  - "src/modules/systems-ops/systems-test.controller.ts"
endpoints:
  - "GET /systems/logs/mongo"
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
aliases:
  - "sin-tag"
related: []
---
# API — `systems-ops`

46 endpoints de operación de plataforma: catálogos autodescriptivos del sistema, revisión, registro de acciones, pruebas y perfiles de estrés.

> [!info] Verificado — la protección llega por un decorador compuesto
> Estos controllers **no** declaran `@ApiTags`, `@UseGuards` ni `@Roles` de forma directa. Los aplica `@SystemsOpsControllerSecurity()` ([`src/modules/systems-ops/systems-controller.decorators.ts`](../../../../../src/modules/systems-ops/systems-controller.decorators.ts)), que compone con `applyDecorators`:
>
> ```ts
> ApiTags('systems-ops')
> ApiBearerAuth('access-token')
> UseGuards(JwtAuthGuard, RolesGuard)
> Roles(...SYSTEMS_OPS_ROLES)
> ```
>
> **Todas estas rutas exigen JWT y rol**, aunque no se vea en el archivo del controller. Agrupar la política de seguridad en un decorador evita que un controller nuevo del módulo nazca sin protección por olvido.

## Roles con acceso

`SYSTEMS_OPS_ROLES`: `system_admin`, `platform_admin`, `admin`, `qa_engineer`, `devops`, `risk_analyst`, `compliance_analyst`, `readonly_auditor`.

El módulo además separa por superficie de acción — `SYSTEMS_OPS_GOVERNANCE_ROLES`, `SYSTEMS_OPS_QA_ROLES`, `SYSTEMS_OPS_STRESS_ROLES` — con la regla de que `readonly_auditor` **puede leer pero nunca escribir**. Ver [`systems-ops.constants.ts`](../../../../../src/modules/systems-ops/systems-ops.constants.ts).

## Endpoints

| Método | Ruta | Auth | Códigos | Propósito |
|---|---|---|---|---|
| `GET` | `/systems/logs/mongo` | 🔒 JWT + rol | 200, 503 | Listar logs sincronizados a MongoDB (Archivo.log remoto) |
| `GET` | `/systems/action-logs` | 🔒 JWT + rol | 200 | Listar registros de auditoría de acciones internas (systems) |
| `GET` | `/systems/action-logs/request/:requestId` | 🔒 JWT + rol | 200 | Action logs de un request (alias) |
| `GET` | `/systems/action-logs/by-request/:requestId` | 🔒 JWT + rol | 200 | Action logs de un request |
| `GET` | `/systems/reports/traffic-latency` | 🔒 JWT + rol | 200 | Reporte de tráfico y latencia por ruta (derivado de system_action_logs) |
| `GET` | `/systems/reports/traffic-latency-timeseries` | 🔒 JWT + rol | 200 | Serie de tiempo de tráfico y latencia agrupada en buckets fijos (derivado de system_action_logs) |
| `GET` | `/systems/dashboard` | 🔒 JWT + rol | 200 | Dashboard resumen de systems-ops |
| `GET` | `/systems/endpoints` | 🔒 JWT + rol | 200 | Listar endpoints catalogados |
| `GET` | `/systems/endpoints/:endpointId` | 🔒 JWT + rol | 200, 404 | Obtener un endpoint catalogado |
| `POST` | `/systems/endpoints/discover` | 🔒 JWT + rol | 201 | Descubrir endpoints (escaneo de código fuente) |
| `POST` | `/systems/endpoints/catalog-seed/refresh` | 🔒 JWT + rol | 201 | Refrescar el seed del catálogo (herramientas, entidades, endpoints) |
| `GET` | `/systems/tools` | 🔒 JWT + rol | 200 | Listar herramientas catalogadas |
| `GET` | `/systems/tools/:toolId` | 🔒 JWT + rol | 200, 404 | Obtener una herramienta catalogada |
| `POST` | `/systems/tools/infer-requirements` | 🔒 JWT + rol | 201 | Inferir requisitos de herramientas (a partir del catálogo) |
| `POST` | `/systems/data-entities/infer-impacts` | 🔒 JWT + rol | 201 | Inferir impactos endpoint-tabla (a partir del código fuente) |
| `GET` | `/systems/data-entities` | 🔒 JWT + rol | 200 | Listar entidades de datos catalogadas |
| `GET` | `/systems/domains` | 🔒 JWT + rol | 200 | Listar dominios de negocio catalogados (con descripción y owner) |
| `GET` | `/systems/domains/:domainCode` | 🔒 JWT + rol | 200, 404 | Obtener un dominio catalogado por código |
| `GET` | `/systems/data-entities/:entityId` | 🔒 JWT + rol | 200, 404 | Obtener una entidad de datos catalogada |
| `PATCH` | `/systems/data-entities/:entityId/metadata` | 🔒 JWT + rol | 200, 404 | Actualizar metadata de una entidad de datos |
| `GET` | `/systems/impact/by-endpoint/:endpointId` | 🔒 JWT + rol | 200 | Impacto de datos de un endpoint |
| `GET` | `/systems/impact/by-table/:schemaName/:tableName` | 🔒 JWT + rol | 200 | Impacto de datos de una tabla |
| `GET` | `/systems/health/tools` | 🔒 JWT + rol | 200 | Salud de herramientas catalogadas |
| `GET` | `/systems/review-queue` | 🔒 JWT + rol | 200 | Cola de revisión del catálogo interno |
| `PATCH` | `/systems/endpoints/:endpointId/review` | 🔒 JWT + rol | 200, 404 | Revisar (aprobar/rechazar) un endpoint catalogado |
| `PATCH` | `/systems/tools/requirements/:requirementId/review` | 🔒 JWT + rol | 200, 404 | Revisar (aprobar/rechazar) un requisito de herramienta |
| `PATCH` | `/systems/data-entities/:entityId/review` | 🔒 JWT + rol | 200, 404 | Revisar (aprobar/rechazar) una entidad de datos |
| `PATCH` | `/systems/impact/data/:impactId/review` | 🔒 JWT + rol | 200, 404 | Revisar (aprobar/rechazar) un impacto de datos |
| `PATCH` | `/systems/impact/fields/:fieldImpactId/review` | 🔒 JWT + rol | 200, 404 | Revisar (aprobar/rechazar) un impacto de campo |
| `PATCH` | `/systems/data-entities/columns/:columnId/review` | 🔒 JWT + rol | 200, 404 | Revisar (aprobar/rechazar) una columna de datos |
| `GET` | `/systems/stress-profiles` | 🔒 JWT + rol | 200 | Listar perfiles de pruebas de estrés |
| `GET` | `/systems/stress-profiles/:profileId` | 🔒 JWT + rol | 200, 404 | Obtener un perfil de pruebas de estrés |
| `POST` | `/systems/stress-profiles/:profileId/queue-run` | 🔒 JWT + rol | 201, 404, 422 | Encolar una corrida de un perfil de estrés |
| `POST` | `/systems/stress-profiles` | 🔒 JWT + rol | 201 | Crear o actualizar un perfil de pruebas de estrés |
| `GET` | `/systems/stress-matrix` | 🔒 JWT + rol | 200 | Matriz de cobertura de pruebas de estrés por endpoint |
| `GET` | `/systems/stress-runs` | 🔒 JWT + rol | 200 | Listar corridas de pruebas de estrés |
| `POST` | `/systems/test-suites` | 🔒 JWT + rol | 201 | Crear una suite de pruebas |
| `GET` | `/systems/test-suites` | 🔒 JWT + rol | 200 | Listar suites de pruebas |
| `GET` | `/systems/test-suites/:suiteId` | 🔒 JWT + rol | 200, 404 | Obtener una suite de pruebas (con sus steps) |
| `PATCH` | `/systems/test-suites/:suiteId` | 🔒 JWT + rol | 200, 404 | Actualizar una suite de pruebas |
| `POST` | `/systems/test-suites/:suiteId/steps` | 🔒 JWT + rol | 201, 404 | Crear un step dentro de una suite de pruebas |
| `PATCH` | `/systems/test-suites/:suiteId/steps/:stepId` | 🔒 JWT + rol | 200, 404 | Actualizar un step de una suite de pruebas |
| `POST` | `/systems/test-suites/:suiteId/steps/reorder` | 🔒 JWT + rol | 201, 404 | Reordenar los steps de una suite de pruebas |
| `POST` | `/systems/test-suites/:suiteId/run` | 🔒 JWT + rol | 201, 404 | Ejecutar una suite de pruebas |
| `GET` | `/systems/test-runs` | 🔒 JWT + rol | 200 | Listar corridas de suites de pruebas |
| `GET` | `/systems/test-runs/:runId` | 🔒 JWT + rol | 200, 404 | Obtener una corrida de suite de pruebas |

## Evidencia

- [`src/modules/log-sync/mongo-logs.controller.ts`](../../../../../src/modules/log-sync/mongo-logs.controller.ts)
- [`src/modules/systems-ops/systems-action-log.controller.ts`](../../../../../src/modules/systems-ops/systems-action-log.controller.ts)
- [`src/modules/systems-ops/systems-catalog.controller.ts`](../../../../../src/modules/systems-ops/systems-catalog.controller.ts)
- [`src/modules/systems-ops/systems-review.controller.ts`](../../../../../src/modules/systems-ops/systems-review.controller.ts)
- [`src/modules/systems-ops/systems-stress.controller.ts`](../../../../../src/modules/systems-ops/systems-stress.controller.ts)
- [`src/modules/systems-ops/systems-test.controller.ts`](../../../../../src/modules/systems-ops/systems-test.controller.ts)

## Relaciones

- [[03-domains/systems-ops/index]] · [[04-api/index]] · [[15-reference/endpoint-catalog]] · [[15-reference/permissions-matrix]]
