/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Quien declara el género «Otro» tiene que poder decir cuál, en sus palabras; si no, «Otro» no le describe a nadie.
 * @system agrega `customer_profile_versions.gender_self_described` (texto corto, nulable).
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = { tableName: 'customer_profile_versions', schema: atlasSchemaFor('customer_profile_versions') };

/**
 * Nulable y sin relleno: `NULL` significa «no lo escribió» (o se declaró antes de que existiera el campo).
 * Va en la VERSIÓN del perfil, como `gender_declared`, para que el historial diga qué se declaró y cuándo.
 * No entra en ninguna decisión de crédito.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const columnas = await queryInterface.describeTable(TABLA);
  if (columnas['gender_self_described']) return;
  await queryInterface.addColumn(TABLA, 'gender_self_described', { type: DataTypes.STRING(60), allowNull: true });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.removeColumn(TABLA, 'gender_self_described');
}
