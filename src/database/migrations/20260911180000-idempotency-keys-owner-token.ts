/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza impide que un proceso caído y resucitado pise el resultado de quien recuperó su trabajo.
 * @system añade a las claves de idempotencia el testigo de la concesión vigente (fencing, AT-009).
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const KEYS = `${atlasSchemaFor('idempotency_keys')}.idempotency_keys`;

/**
 * Expansiva y nullable: las filas existentes siguen siendo válidas (sin testigo ⇒ nadie la posee y
 * cualquier recuperación puede reclamarla). El índice único de creación no cambia; el testigo cubre
 * la otra mitad del problema, la RECUPERACIÓN de un lease vencido por dos procesos a la vez.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${KEYS} ADD COLUMN IF NOT EXISTS owner_token VARCHAR(64);`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${KEYS} DROP COLUMN IF EXISTS owner_token;`);
}
