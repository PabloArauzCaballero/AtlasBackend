# Estado del plan de mejora del modelo de datos PostgreSQL

Seguimiento de la implementación del `PLAN_MEJORA_MODELO_DATOS_POSTGRES_ATLAS.md`.

| Fase | Alcance | Estado | Artefactos |
| ---- | ------- | ------ | ---------- |
| **0** | Inventario de workload + baseline p50/p95/p99 | ◑ Scaffolding listo; faltan datos reales | Docs plantilla (`read-workload-inventory.md`, `query-baseline.md`, `view-candidates.md`) + scripts `db:extract-read-workload` y `db:capture-query-baseline`. Los números se llenan desde staging con `pg_stat_statements`. |
| **1** | Perfiles de seeds (production/development/demo/test) + runner + guards | ✅ Implementada | `src/database/seed.ts`, `seed-profiles.ts`, `seeders/{production,development,demo,test}/`, `scripts/check-seed-profile.ts`, tests. |
| **2** | Roles PostgreSQL (owner/migrator/rw/ro) + grants + verificación | ✅ Implementada | `ops/postgres/*.sql`, `docs/database/postgres-roles.md`, `scripts/check-db-privileges.ts`, `DB_READ_*` en env. |
| **3** | Schema `read_api` + primera ola de 7 vistas versionadas | ✅ Implementada | `migrations/20260715120000-create-read-api-schema-and-views-v1.ts`, `docs/database/read-models.md`. |
| **4** | Migración de repositorios a las vistas + deprecación de rutas offset | ◑ Iniciada | Ruta de auditoría por offset marcada `deprecated: true` en OpenAPI (§25). Las vistas y el `ReadQueryService` están listos; la migración de cada repositorio se hace por módulo con medición. |
| **5** | Conexión read-only opcional (segundo pool) | ✅ Implementada (opt-in) | `read-database.module.ts`, `common/database/read-query.service.ts`, `DB_READ_ENABLED`. |
| **6** | Materialized views (`mv_*`) | ⏳ Solo con evidencia | El plan (§22) exige justificarlas con métricas + job de refresh; no se crean por defecto. |
| **7** | Gates de CI (seeds, privilegios, vistas, overfetching) | ✅ Implementada | `scripts/check-*.ts`, `verify-prod-seed-idempotency.ts`, `.github/workflows/ci.yml`. |

## Verificación local ya realizada

- `yarn type-check`, `yarn lint`, `yarn test:unit` (895 tests) en verde.
- `yarn check:seed-profiles`, `yarn check:overfetching` en verde.
- Tests unitarios nuevos: `test/unit/database/seed-profile.spec.ts`, `read-query.service.spec.ts`.

## Verificación pendiente contra Postgres real (la corre CI, job `db-and-cache-integration`)

- `yarn db:migration:up` aplica la migración de `read_api` sin error.
- `yarn db:seed:demo` carga el dataset completo (production + development + demo).
- `yarn check:read-api-views` confirma existencia + smoke SELECT + EXPLAIN.
- `yarn db:seed:verify-prod-idempotency` confirma que los seeders de producción no duplican.
- `ops/postgres/*.sql` + `yarn check:db-privileges` validan la matriz de privilegios.

## Notas de decisiones no triviales

- El seeder combinado `internal-rbac-and-pablo` se **dividió**: catálogo RBAC → `production/`, usuario
  Pablo → `development/`.
- El ruleset/modelo de riesgo `_id = 101` (del que depende el baseline BNPL productivo) se **movió**
  del seeder demo a un seeder productivo (`production/20260711085000-seed-risk-baseline-ruleset.ts`),
  para que `db:seed:prod` sea autosuficiente.
- Las vistas usan las columnas REALES del esquema (p. ej. consentimiento activo = `granted AND
  revoked_at IS NULL`; "abierto" = `closed_at IS NULL`), no las asumidas en el plan.
