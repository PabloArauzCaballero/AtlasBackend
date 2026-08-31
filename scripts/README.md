<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# scripts

## Por qué existe

- **Negocio:** esta carpeta convierte operaciones delicadas en procedimientos repetibles y verificables.
- **Sistema:** esta carpeta automatiza gates, desarrollo, migraciones, seeds, smokes y mantenimiento.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`bootstrap-db-roles.ts`](./bootstrap-db-roles.ts) | Artefacto de soporte específico de esta carpeta. |
| [`capture-query-baseline.ts`](./capture-query-baseline.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-auth-coverage.ts`](./check-auth-coverage.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-db-privileges.ts`](./check-db-privileges.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-domain-schema-layout.ts`](./check-domain-schema-layout.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-domain-schemas.ts`](./check-domain-schemas.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-entity-narratives.ts`](./check-entity-narratives.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-env-example.ts`](./check-env-example.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-file-size.ts`](./check-file-size.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-migrations.ts`](./check-migrations.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`check-nest-entrypoints.ts`](./check-nest-entrypoints.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-no-env-file.ts`](./check-no-env-file.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-no-tracked-smoke-results.ts`](./check-no-tracked-smoke-results.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-openapi-contract.ts`](./check-openapi-contract.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-overfetching.ts`](./check-overfetching.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-read-api-honesty.ts`](./check-read-api-honesty.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-read-api-views.ts`](./check-read-api-views.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-retention-coverage.ts`](./check-retention-coverage.ts) | Artefacto de soporte específico de esta carpeta. |
| [`check-tenant-header-usage.ts`](./check-tenant-header-usage.ts) | Artefacto de soporte específico de esta carpeta. |
| [`cleanup-legacy-configs.cjs`](./cleanup-legacy-configs.cjs) | Artefacto de soporte específico de esta carpeta. |
| [`create-dev-jwt.ts`](./create-dev-jwt.ts) | Artefacto de soporte específico de esta carpeta. |
| [`create-migration.ts`](./create-migration.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`dev-build-and-start.mjs`](./dev-build-and-start.mjs) | Artefacto de soporte específico de esta carpeta. |
| [`env-doctor.ts`](./env-doctor.ts) | Artefacto de soporte específico de esta carpeta. |
| [`extract-read-workload.ts`](./extract-read-workload.ts) | Artefacto de soporte específico de esta carpeta. |
| [`gate-skip-policy.ts`](./gate-skip-policy.ts) | Artefacto de soporte específico de esta carpeta. |
| [`generate-openapi.ts`](./generate-openapi.ts) | Artefacto de soporte específico de esta carpeta. |
| [`generate-project-documentation.ts`](./generate-project-documentation.ts) | Artefacto de soporte específico de esta carpeta. |
| [`hash-password.ts`](./hash-password.ts) | Artefacto de soporte específico de esta carpeta. |
| [`inject-atlas-context-seeds.ts`](./inject-atlas-context-seeds.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`load-multidomain-context.ts`](./load-multidomain-context.ts) | Artefacto de soporte específico de esta carpeta. |
| [`reencrypt-pii-to-envelope.ts`](./reencrypt-pii-to-envelope.ts) | Artefacto de soporte específico de esta carpeta. |
| [`run-dev.mjs`](./run-dev.mjs) | Artefacto de soporte específico de esta carpeta. |
| [`seed-demo-portfolio.sql`](./seed-demo-portfolio.sql) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`verify-seed-graph-integrity.ts`](./verify-seed-graph-integrity.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |

## Subcarpetas

- [`mkdocs/`](./mkdocs/README.md)
- [`perf/`](./perf/README.md)
- [`smoke/`](./smoke/README.md)
- [`stress/`](./stress/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
