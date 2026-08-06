---
title: "Esquema platform_ops — Operación de plataforma"
type: "data"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
schema: "platform_ops"
tags:
  - "backend"
  - "data"
  - "schema"
  - "schema/platform_ops"
source_files:
  - "src/database/domain-schemas.ts"
---
# Esquema `platform_ops` — Operación de plataforma

25 tabla(s) · 516 atributos.

> [!info] Verificado
> Los esquemas físicos se declaran en `ATLAS_DOMAIN_TABLES` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts). Cada modelo resuelve el suyo con `atlasSchemaFor(tableName)`, que **lanza** si la tabla no está registrada: no existe una segunda fuente de verdad.

## Tablas

| Tabla | Modelo ORM | Atributos | FK salientes | Referencias entrantes |
|---|---|---|---|---|
| [[idempotency_keys]] | `IdempotencyKeyModel` | 14 | 0 | 0 |
| [[outbox_events]] | `OutboxEventModel` | 27 | 0 | 0 |
| [[system_action_logs]] | `SystemActionLogModel` | 34 | 0 | 0 |
| [[system_catalog_review_events]] | `SystemCatalogReviewEventModel` | 12 | 0 | 0 |
| [[system_data_field_catalog]] | `SystemDataFieldCatalogModel` | 60 | 0 | 0 |
| [[system_data_relationship_catalog]] | `SystemDataRelationshipCatalogModel` | 24 | 0 | 0 |
| [[system_domain_catalog]] | `SystemDomainCatalogModel` | 16 | 0 | 0 |
| [[system_endpoint_catalog]] | `SystemEndpointCatalogModel` | 42 | 0 | 0 |
| [[system_endpoint_data_entity_impacts]] | `SystemEndpointDataEntityImpactModel` | 23 | 0 | 0 |
| [[system_endpoint_field_impacts]] | `SystemEndpointFieldImpactModel` | 16 | 0 | 0 |
| [[system_endpoint_payload_contracts]] | `SystemEndpointPayloadContractModel` | 16 | 0 | 0 |
| [[system_endpoint_tool_requirements]] | `SystemEndpointToolRequirementModel` | 15 | 0 | 0 |
| [[system_job_runs]] | `SystemJobRunModel` | 12 | 0 | 0 |
| [[system_operational_rule_catalog]] | `SystemOperationalRuleCatalogModel` | 22 | 0 | 0 |
| [[system_stress_profiles]] | `SystemStressProfileModel` | 18 | 0 | 0 |
| [[system_test_runs]] | `SystemTestRunModel` | 13 | 0 | 0 |
| [[system_test_step_runs]] | `SystemTestStepRunModel` | 10 | 0 | 0 |
| [[system_test_steps]] | `SystemTestStepModel` | 17 | 0 | 0 |
| [[system_test_suites]] | `SystemTestSuiteModel` | 15 | 0 | 0 |
| [[system_tool_catalog]] | `SystemToolCatalogModel` | 16 | 0 | 0 |
| [[workflow_definitions]] | `WorkflowDefinitionModel` | 22 | 0 | 0 |
| [[workflow_stages]] | `WorkflowStageModel` | 20 | 0 | 0 |
| [[workflow_step_dependencies]] | `WorkflowStepDependencyModel` | 8 | 0 | 0 |
| [[workflow_steps]] | `WorkflowStepModel` | 32 | 0 | 0 |
| [[workflow_transitions]] | `WorkflowTransitionModel` | 12 | 0 | 0 |

## Acoplamiento con otros esquemas

- **Depende de** (FK salientes hacia): ninguno
- **Es referenciado por**: ninguno
- FK que cruzan el límite del esquema: **0 salientes**, **0 entrantes**.



## Diagrama entidad-relación (intra-esquema)

```mermaid
erDiagram
  %% sin relaciones internas a este esquema
```

Solo se representan las relaciones cuyos dos extremos viven en `platform_ops`. Las relaciones cruzadas están en [[05-data/relationship-catalog]].

## Relaciones

- Modelo global: [[05-data/entity-relationship-model]]
- Arquitectura de datos: [[05-data/data-architecture]]
