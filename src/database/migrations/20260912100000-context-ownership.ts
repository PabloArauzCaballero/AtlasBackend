/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza crea el registro de escritor único por contexto para el corte del piloto de Mensajería.
 * @system crea `platform_ops.context_ownership` (AT-059) y siembra `messaging → monolith` con época 1;
 *   expansiva: nadie la lee hasta que el relay v2 o el worker del piloto la consultan.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('context_ownership');
const TABLE = `${SCHEMA}.context_ownership`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const sql = queryInterface.sequelize;
  await sql.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    context VARCHAR(60) PRIMARY KEY,
    owner VARCHAR(80) NOT NULL,
    epoch BIGINT NOT NULL DEFAULT 1,
    changed_by VARCHAR(120),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`);
  // Estado inicial: el monolito es el dueño de Mensajería. Idempotente: no pisa una transferencia hecha.
  await sql.query(`INSERT INTO ${TABLE} (context, owner, epoch, changed_by) VALUES ('messaging', 'monolith', 1, 'migration')
    ON CONFLICT (context) DO NOTHING;`);
  // Los roles por contexto consultan (y el dueño transfiere) la propiedad; mismo patrón que AT-053.
  await sql.query(`DO $$
    DECLARE role_name text;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY['atlas_ctx_messaging', 'atlas_ctx_credit', 'atlas_ctx_customer'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('GRANT SELECT, UPDATE ON ${TABLE} TO %I', role_name);
        END IF;
      END LOOP;
    END $$;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  // Estructural: se pierde la época. Antes de bajarla, el dueño debe ser el monolito (runbook de corte).
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
