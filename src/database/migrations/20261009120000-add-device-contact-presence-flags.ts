/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business La app deja de mandar correos y cumpleaños de los contactos (minimización); manda sólo si existían.
 * @system agrega a `customer_device_contacts` tres banderas nulables: si la ficha tiene correo, cumpleaños y empresa.
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = { tableName: 'customer_device_contacts', schema: atlasSchemaFor('customer_device_contacts') };
const COLUMNAS = ['has_email', 'has_birthday', 'has_company'] as const;

/**
 * Nulables y sin rellenar: `NULL` es «la captura no lo dijo». Las filas anteriores siguen leyéndose por sus datos
 * (`email_count`, `birthday`, `contact_type`), así que no hace falta tocar ni una (`fichaObservadaDeFila`). Sólo
 * DDL: no escribe datos.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const columnas = await queryInterface.describeTable(TABLA);
  for (const nombre of COLUMNAS) {
    if (!columnas[nombre]) await queryInterface.addColumn(TABLA, nombre, { type: DataTypes.BOOLEAN, allowNull: true });
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const columnas = await queryInterface.describeTable(TABLA);
  for (const nombre of [...COLUMNAS].reverse()) {
    if (columnas[nombre]) await queryInterface.removeColumn(TABLA, nombre);
  }
}
