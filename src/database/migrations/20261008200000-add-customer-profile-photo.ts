/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business La persona puede poner su foto de perfil en la app; la foto vive en el almacén y aquí sólo su clave.
 * @system agrega a `customers` la clave del objeto de la foto de perfil y cuándo se cambió por última vez.
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = { tableName: 'customers', schema: atlasSchemaFor('customers') };

/**
 * Nulables: `NULL` es «sin foto», que es el estado de todo cliente existente. Va en `customers` y no en la versión del
 * perfil porque no es un dato declarado que haya que versionar para la evaluación: es una preferencia visual, y cambiarla
 * no debe abrir una versión nueva del perfil.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const columnas = await queryInterface.describeTable(TABLA);
  if (!columnas.profile_photo_key) {
    await queryInterface.addColumn(TABLA, 'profile_photo_key', { type: DataTypes.STRING(300), allowNull: true });
  }
  if (!columnas.profile_photo_updated_at) {
    await queryInterface.addColumn(TABLA, 'profile_photo_updated_at', { type: DataTypes.DATE, allowNull: true });
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.removeColumn(TABLA, 'profile_photo_updated_at');
  await queryInterface.removeColumn(TABLA, 'profile_photo_key');
}
