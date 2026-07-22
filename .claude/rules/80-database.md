---
paths:
  - "src/database/migrations/**/*.ts"
  - "src/database/models/**/*.ts"
  - "src/database/seeders/**/*.ts"
  - "ops/postgres/**/*.sql"
---

# Base de datos y migraciones (PostgreSQL + Sequelize)

Fuente: código real + `docs/audit/revision-completa-backend-2026-07-21.md` (sección Base de datos).

- **Nunca `sync({ force })` ni `sync({ alter })`.** `synchronize: false` y `autoLoadModels: false` son obligatorios. El schema se cambia solo por migración.
- **Toda migración tiene `up` y `down`.** El `down` debe revertir la estructura (no necesariamente el backfill de datos). Ninguna operación destructiva dentro de un `up`.
- **Cambios destructivos: expand/contract.** Añadir columna/constraint en pasos idempotentes (`IF NOT EXISTS`, `to_regclass`), backfill, y solo entonces endurecer (`SET NOT NULL`).
- **`_deleted` / soft-delete:** columnas booleanas de borrado lógico deben tener `DEFAULT false` y ser `NOT NULL` (una fila `NULL` es invisible para los filtros `!= true` y escapa de índices únicos parciales).
- **FKs:** usar la política central de `atlas-schema-builder.util.ts` (`SET NULL` si nullable, `RESTRICT` si no, `onUpdate: CASCADE`).
- **Mínimo privilegio:** el runtime corre como `atlas_app_rw` (sin DDL); migraciones como `atlas_migrator`. No pedir DDL al rol de runtime. Roles con `statement_timeout`/`idle_in_transaction_session_timeout`.
- **Seeds:** perfiles (`production|development|demo|test`) con guardas anti-producción. Los seeders de producción deben ser idempotentes (`yarn db:seed:verify-prod-idempotency`).
- **PII:** patrón hash-para-buscar + blob cifrado (envelope encryption). Las columnas cifradas nunca se indexan; las vistas `read_api` no exponen hashes ni blobs.
- **No ejecutar migraciones/seeds contra una base real sin aprobación.** Nunca DDL destructivo en producción.

**Evidencia:** `yarn check:domain-schemas`, `yarn check:domain-schema-layout`, `yarn check:read-api-views`, `yarn check:db-privileges --strict` (en CI).
