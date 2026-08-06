---
title: "schema_constraint_notes"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Auditoría y calidad"
schema: "audit"
table: "schema_constraint_notes"
orm_model: "SchemaConstraintNoteModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/audit"
source_files:
  - "src/database/models/schema-constraint-notes.model.ts"
aliases:
  - "SchemaConstraintNoteModel"
---
# `audit.schema_constraint_notes`

> [!info] Verificado
> Modelo ORM `SchemaConstraintNoteModel` en [`src/database/models/schema-constraint-notes.model.ts`](../../../../src/database/models/schema-constraint-notes.model.ts). Esquema físico `audit` resuelto por `atlasSchemaFor('schema_constraint_notes')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `audit.schema_constraint_notes`
- **Modelo ORM:** `SchemaConstraintNoteModel`
- **Dominio:** Auditoría y calidad → [[audit-schema]]
- **Atributos:** 9 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `tableName` | `table_name` | string \| null | STRING(120) | No | — | — |
| `constraintType` | `constraint_type` | string \| null | STRING(60) | No | — | — |
| `constraintExpression` | `constraint_expression` | string \| null | TEXT | No | — | — |
| `rationale` | `rationale` | string \| null | TEXT | No | — | — |
| `buildPhase` | `build_phase` | string \| null | STRING(40) | No | — | — |
| `isRequiredForMvp` | `is_required_for_mvp` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



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
| — | — | — | — |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/schema-constraint-notes.model.ts`](../../../../src/database/models/schema-constraint-notes.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
