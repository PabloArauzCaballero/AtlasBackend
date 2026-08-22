<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database/seeders/production

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define production para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`20260702032000-seed-external-data-providers.ts`](./20260702032000-seed-external-data-providers.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260703002000-seed-systems-ops-catalog.ts`](./20260703002000-seed-systems-ops-catalog.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260704121000-seed-internal-rbac.ts`](./20260704121000-seed-internal-rbac.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706020000-seed-schema-constraint-notes.ts`](./20260706020000-seed-schema-constraint-notes.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706100000-seed-catalog-entries-v1-risk-income-zones.ts`](./20260706100000-seed-catalog-entries-v1-risk-income-zones.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260711085000-seed-risk-baseline-ruleset.ts`](./20260711085000-seed-risk-baseline-ruleset.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260711090000-seed-bnpl-production-risk-baseline.ts`](./20260711090000-seed-bnpl-production-risk-baseline.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260727120000-seed-data-entity-business-narrative.ts`](./20260727120000-seed-data-entity-business-narrative.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260728091000-seed-customer-financial-attribute-definitions.ts`](./20260728091000-seed-customer-financial-attribute-definitions.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260728140000-seed-standard-customer-credit-workflow.ts`](./20260728140000-seed-standard-customer-credit-workflow.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260729010000-seed-access-journey-workflows.ts`](./20260729010000-seed-access-journey-workflows.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260816090000-seed-asfi-rating-policy.ts`](./20260816090000-seed-asfi-rating-policy.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
