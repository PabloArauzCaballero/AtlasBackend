<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database/seeders/demo

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define demo para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`20260705090000-seed-portal-runtime-demo-data.ts`](./20260705090000-seed-portal-runtime-demo-data.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260705114000-seed-rich-systems-business-metadata.ts`](./20260705114000-seed-rich-systems-business-metadata.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706000000-seed-deep-graph-demo-data.ts`](./20260706000000-seed-deep-graph-demo-data.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706010000-seed-external-provider-and-catalog-governance-demo-data.ts`](./20260706010000-seed-external-provider-and-catalog-governance-demo-data.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
