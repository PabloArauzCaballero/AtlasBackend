<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database/seeders

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`20260626160720-seed-minimal-dev-credentials.ts`](./20260626160720-seed-minimal-dev-credentials.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260702032000-seed-external-data-providers.ts`](./20260702032000-seed-external-data-providers.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260703002000-seed-systems-ops-catalog.ts`](./20260703002000-seed-systems-ops-catalog.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260704121000-seed-internal-rbac-and-pablo.ts`](./20260704121000-seed-internal-rbac-and-pablo.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260705090000-seed-portal-runtime-demo-data.ts`](./20260705090000-seed-portal-runtime-demo-data.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260705114000-seed-rich-systems-business-metadata.ts`](./20260705114000-seed-rich-systems-business-metadata.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706000000-seed-deep-graph-demo-data.ts`](./20260706000000-seed-deep-graph-demo-data.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706010000-seed-external-provider-and-catalog-governance-demo-data.ts`](./20260706010000-seed-external-provider-and-catalog-governance-demo-data.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706020000-seed-schema-constraint-notes.ts`](./20260706020000-seed-schema-constraint-notes.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706100000-seed-catalog-entries-v1-risk-income-zones.ts`](./20260706100000-seed-catalog-entries-v1-risk-income-zones.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260711090000-seed-bnpl-production-risk-baseline.ts`](./20260711090000-seed-bnpl-production-risk-baseline.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |

## Subcarpetas

- [`demo/`](./demo/README.md)
- [`development/`](./development/README.md)
- [`production/`](./production/README.md)
- [`test/`](./test/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
