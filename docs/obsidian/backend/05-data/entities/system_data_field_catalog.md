---
title: "system_data_field_catalog"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_data_field_catalog"
orm_model: "SystemDataFieldCatalogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-data-field-catalog.model.ts"
aliases:
  - "SystemDataFieldCatalogModel"
---
# `platform_ops.system_data_field_catalog`

> [!info] Verificado
> Modelo ORM `SystemDataFieldCatalogModel` en [`src/database/models/system-data-field-catalog.model.ts`](../../../../src/database/models/system-data-field-catalog.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_data_field_catalog')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_data_field_catalog`
- **Modelo ORM:** `SystemDataFieldCatalogModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 60 · **FK salientes:** 0 · **Referencias entrantes:** 0

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`RIESGO` — la tabla **no** tiene `_tenant_id`: es global a la plataforma o el aislamiento depende de la tabla padre. Verificar antes de exponerla en un endpoint por tenant.

## Borrado lógico

`INFERIDO` — sin columna `_deleted`: el borrado es físico o la entidad es de solo-inserción (evento/log).

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `dataEntityId` | `data_entity_id` | string \| null | BIGINT | No | — | — |
| `schemaName` | `schema_name` | string | STRING(120) | Sí | — | — |
| `tableName` | `table_name` | string | STRING(180) | Sí | — | — |
| `columnName` | `column_name` | string | STRING(180) | Sí | — | — |
| `ordinalPosition` | `ordinal_position` | number \| null | INTEGER | No | — | — |
| `sqlDataType` | `sql_data_type` | string \| null | STRING(120) | No | — | — |
| `isNullable` | `is_nullable` | boolean | BOOLEAN | Sí | — | — |
| `columnDefault` | `column_default` | string \| null | TEXT | No | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `detectedFrom` | `detected_from` | string | STRING(80) | Sí | — | — |
| `isPrimaryKey` | `is_primary_key` | boolean | BOOLEAN | Sí | — | — |
| `isForeignKey` | `is_foreign_key` | boolean | BOOLEAN | Sí | — | — |
| `referencedSchema` | `referenced_schema` | string \| null | STRING(120) | No | — | — |
| `referencedTable` | `referenced_table` | string \| null | STRING(180) | No | — | — |
| `referencedColumn` | `referenced_column` | string \| null | STRING(180) | No | — | — |
| `referencesEntityId` | `references_entity_id` | string \| null | BIGINT | No | — | — |
| `businessName` | `business_name` | string \| null | STRING(220) | No | — | — |
| `businessMeaning` | `business_meaning` | string \| null | TEXT | No | — | — |
| `technicalMeaning` | `technical_meaning` | string \| null | TEXT | No | — | — |
| `systemPurpose` | `system_purpose` | string \| null | TEXT | No | — | — |
| `businessPurpose` | `business_purpose` | string \| null | TEXT | No | — | — |
| `whyStore` | `why_store` | string \| null | TEXT | No | — | — |
| `whoUses` | `who_uses` | string[] | JSONB | Sí | — | — |
| `auditUsage` | `audit_usage` | string \| null | TEXT | No | — | — |
| `analysisUsage` | `analysis_usage` | string \| null | TEXT | No | — | — |
| `decisionUsage` | `decision_usage` | string \| null | TEXT | No | — | — |
| `sourceKind` | `source_kind` | string \| null | STRING(80) | No | — | — |
| `payloadPathsJson` | `payload_paths_json` | string[] | JSONB | Sí | — | — |
| `backendWriteBehavior` | `backend_write_behavior` | string \| null | TEXT | No | — | — |
| `dataNature` | `data_nature` | string \| null | STRING(60) | No | — | — |
| `domainCode` | `domain_code` | string \| null | STRING(120) | No | — | — |
| `governanceCategory` | `governance_category` | string \| null | STRING(80) | No | — | — |
| `classificationCode` | `classification_code` | string \| null | STRING(120) | No | — | — |
| `sensitivityLevel` | `sensitivity_level` | string \| null | STRING(40) | No | — | — |
| `containsPii` | `contains_pii` | boolean | BOOLEAN | Sí | — | — |
| `piiType` | `pii_type` | string \| null | STRING(120) | No | — | — |
| `containsSensitive` | `contains_sensitive` | boolean | BOOLEAN | Sí | — | — |
| `containsFinancialData` | `contains_financial_data` | boolean | BOOLEAN | Sí | — | — |
| `containsRiskData` | `contains_risk_data` | boolean | BOOLEAN | Sí | — | — |
| `containsFraudSignal` | `contains_fraud_signal` | boolean | BOOLEAN | Sí | — | — |
| `containsCapacitySignal` | `contains_capacity_signal` | boolean | BOOLEAN | Sí | — | — |
| `isMlCandidate` | `is_ml_candidate` | boolean | BOOLEAN | Sí | — | — |
| `usedInScoring` | `used_in_scoring` | boolean | BOOLEAN | Sí | — | — |
| `usedInMl` | `used_in_ml` | boolean | BOOLEAN | Sí | — | — |
| `mlFeatureGroup` | `ml_feature_group` | string \| null | STRING(120) | No | — | — |
| `qualityRulesJson` | `quality_rules_json` | unknown[] | JSONB | Sí | — | — |
| `validationRuleJson` | `validation_rule_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `allowedValues` | `allowed_values` | unknown[] \| null | JSONB | No | — | — |
| `retentionPolicyCode` | `retention_policy_code` | string \| null | STRING(120) | No | — | — |
| `frontendLabel` | `frontend_label` | string \| null | STRING(220) | No | — | — |
| `formUsage` | `form_usage` | string \| null | TEXT | No | — | — |
| `relationshipNotes` | `relationship_notes` | string \| null | TEXT | No | — | — |
| `operationalNotes` | `operational_notes` | string \| null | TEXT | No | — | — |
| `sourceDocument` | `source_document` | string | STRING(120) | Sí | — | — |
| `confidenceLevel` | `confidence_level` | string | STRING(20) | Sí | — | — |
| `reviewStatus` | `review_status` | string | STRING(40) | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date | DATE | Sí | — | — |
| `manuallyEditedAt` | `manually_edited_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `schema_name, table_name, column_name` | Único | — | btree |
| `data_entity_id` | No único | — | btree |
| `domain_code` | No único | — | btree |
| `contains_pii` | No único | — | btree |
| `is_ml_candidate` | No único | — | btree |
| `schema_name, table_name, column_name` | Único | — | btree |
| `data_entity_id` | No único | — | btree |
| `table_name` | No único | — | btree |
| `contains_pii` | No único | — | btree |
| `is_ml_candidate` | No único | — | btree |
| `status` | No único | — | btree |
| `review_status` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-data-field-catalog.model.ts`](../../../../src/database/models/system-data-field-catalog.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
