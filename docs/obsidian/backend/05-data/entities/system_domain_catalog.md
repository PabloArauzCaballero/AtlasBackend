---
title: "system_domain_catalog"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_domain_catalog"
orm_model: "SystemDomainCatalogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-domain-catalog.model.ts"
aliases:
  - "SystemDomainCatalogModel"
---
# `platform_ops.system_domain_catalog`

> [!info] Verificado
> Modelo ORM `SystemDomainCatalogModel` en [`src/database/models/system-domain-catalog.model.ts`](../../../../../src/database/models/system-domain-catalog.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_domain_catalog')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_domain_catalog`
- **Modelo ORM:** `SystemDomainCatalogModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 16 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `domainCode` | `domain_code` | string | STRING(120) | Sí | — | — |
| `domainName` | `domain_name` | string | STRING(220) | Sí | — | — |
| `description` | `description` | string | TEXT | Sí | — | — |
| `businessDefinition` | `business_definition` | string | TEXT | Sí | — | — |
| `technicalScope` | `technical_scope` | string | TEXT | Sí | — | — |
| `dataNature` | `data_nature` | string | STRING(60) | Sí | — | — |
| `ownerTeam` | `owner_team` | string | STRING(120) | Sí | — | — |
| `countriesApplicable` | `countries_applicable` | string[] | JSONB | Sí | — | — |
| `regulatoryNotes` | `regulatory_notes` | string \| null | TEXT | No | — | — |
| `exampleTables` | `example_tables` | string[] | JSONB | Sí | — | — |
| `decisionUseCases` | `decision_use_cases` | string[] | JSONB | Sí | — | — |
| `auditRelevance` | `audit_relevance` | string \| null | TEXT | No | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date | DATE | Sí | — | — |



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
| `data_nature` | No único | — | btree |
| `owner_team` | No único | — | btree |
| `status` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-domain-catalog.model.ts`](../../../../../src/database/models/system-domain-catalog.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
