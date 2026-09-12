/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza impide que un contexto ajeno se declare dueño del escritor único de otro.
 * @system corrige los grants de `platform_ops.context_ownership` (revisión independiente, hallazgo 3):
 *   la migración `20260912100000` dio `SELECT, UPDATE` a los tres roles de contexto, así que
 *   `atlas_ctx_credit` o `atlas_ctx_customer` podían arrebatar por SQL la propiedad de `messaging`.
 *   Se deja `SELECT` a los tres (todos consultan antes de reclamar) y se retira `UPDATE`: la
 *   transferencia la ejecuta el dueño de la base siguiendo el runbook de corte, no un contexto.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('context_ownership')}.context_ownership`;
const CONTEXT_ROLES = ['atlas_ctx_messaging', 'atlas_ctx_credit', 'atlas_ctx_customer'];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DO $$
    DECLARE role_name text;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY[${CONTEXT_ROLES.map((role) => `'${role}'`).join(', ')}] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('REVOKE UPDATE ON ${TABLE} FROM %I', role_name);
          EXECUTE format('GRANT SELECT ON ${TABLE} TO %I', role_name);
        END IF;
      END LOOP;
    END $$;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  // Vuelve al estado anterior (UPDATE para los tres). Es menos seguro a propósito: sólo para revertir.
  await queryInterface.sequelize.query(`DO $$
    DECLARE role_name text;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY[${CONTEXT_ROLES.map((role) => `'${role}'`).join(', ')}] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('GRANT SELECT, UPDATE ON ${TABLE} TO %I', role_name);
        END IF;
      END LOOP;
    END $$;`);
}
