import { QueryInterface } from 'sequelize';
import { ATLAS_SCHEMAS } from '../domain-schemas.js';

/**
 * Endurece la columna `_deleted` (soft-delete) en todas las tablas de dominio.
 *
 * Problema (auditoría 2026-07-21, DB-M1): `_deleted` es BOOLEAN nullable sin DEFAULT y los
 * repositorios filtran con `_deleted != true`. En SQL `NULL != true` es NULL, así que una fila con
 * `_deleted = NULL` (posible en cualquier INSERT crudo/ETL/seeder que la omita) es INVISIBLE para
 * la aplicación y además escapa de los índices únicos parciales `WHERE _deleted = false`. Hoy solo
 * funciona porque el ORM setea `_deleted = false` en cada create.
 *
 * Expand de libro: (1) DEFAULT false, (2) backfill de los NULL existentes, (3) NOT NULL. Se aplica
 * dinámicamente a toda columna `_deleted` nullable en los schemas de dominio + public (para tablas
 * aún no migradas al split de schemas). Idempotente: si ya es NOT NULL, information_schema no la
 * devuelve y se omite.
 */
const TARGET_SCHEMAS = [...Object.values(ATLAS_SCHEMAS), 'public'];
const SCHEMA_LIST = TARGET_SCHEMAS.map((schema) => `'${schema}'`).join(', ');

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.query(`
    DO $$
    DECLARE target RECORD;
    BEGIN
      FOR target IN
        SELECT table_schema, table_name
          FROM information_schema.columns
         WHERE column_name = '_deleted'
           AND is_nullable = 'YES'
           AND data_type = 'boolean'
           AND table_schema IN (${SCHEMA_LIST})
      LOOP
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN _deleted SET DEFAULT false', target.table_schema, target.table_name);
        EXECUTE format('UPDATE %I.%I SET _deleted = false WHERE _deleted IS NULL', target.table_schema, target.table_name);
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN _deleted SET NOT NULL', target.table_schema, target.table_name);
      END LOOP;
    END$$;
  `);
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  // Revierte solo la restricción estructural (NOT NULL + DEFAULT). El backfill no se revierte: no se
  // puede distinguir qué filas eran NULL originalmente, y `_deleted = false` es semánticamente correcto.
  await queryInterface.sequelize.query(`
    DO $$
    DECLARE target RECORD;
    BEGIN
      FOR target IN
        SELECT table_schema, table_name
          FROM information_schema.columns
         WHERE column_name = '_deleted'
           AND is_nullable = 'NO'
           AND data_type = 'boolean'
           AND table_schema IN (${SCHEMA_LIST})
      LOOP
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN _deleted DROP NOT NULL', target.table_schema, target.table_name);
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN _deleted DROP DEFAULT', target.table_schema, target.table_name);
      END LOOP;
    END$$;
  `);
}
