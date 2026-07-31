/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE system_data_relationship_catalog
      ALTER COLUMN optionality TYPE VARCHAR(60);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE system_data_relationship_catalog
      ALTER COLUMN optionality TYPE VARCHAR(40);
  `);
}
