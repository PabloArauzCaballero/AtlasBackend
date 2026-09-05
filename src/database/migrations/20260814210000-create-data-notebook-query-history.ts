/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('data_notebook_query_history');
const TABLE = 'data_notebook_query_history';

/**
 * El historial del cuaderno de datos: qué se preguntó, nunca qué se obtuvo.
 *
 * La tabla NO tiene columna donde quepa un resultado, y eso es la mitad del diseño. Guardar
 * también las filas devueltas convertiría este historial en una segunda copia de los datos
 * personales, fuera de `read_api`, sin su enmascarado y sin caducidad — es decir, en el mayor
 * problema de privacidad de todo el módulo, creado por la función pensada para dar trazabilidad.
 * Sin la columna, no hay que acordarse de no llenarla.
 *
 * El código SÍ se guarda, y es lo que vale: es el artefacto reproducible. Con la celda y el
 * dataset se puede volver a ejecutar y obtener el mismo resultado —contra los datos de HOY, que
 * es lo correcto para auditar— sin conservar una foto de datos de nadie.
 *
 * `row_count` y `duration_ms` son medidas, no datos: dicen si una consulta se llevó diez filas o
 * veinte mil, que es justo la señal que distingue una exploración de una extracción.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.createTable(
    { schema: SCHEMA, tableName: TABLE },
    {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
      actor_user_id: { type: DataTypes.STRING(80), allowNull: true },
      actor_role: { type: DataTypes.STRING(80), allowNull: true },
      language: { type: DataTypes.STRING(20), allowNull: false },
      /** El código de la celda. Es texto y no se ejecuta NUNCA en el servidor. */
      source: { type: DataTypes.TEXT, allowNull: false },
      dataset_code: { type: DataTypes.STRING(64), allowNull: true },
      dataset_page: { type: DataTypes.INTEGER, allowNull: true },
      row_count: { type: DataTypes.INTEGER, allowNull: true },
      duration_ms: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false },
      /** Mensaje de error recortado. No lleva datos: un traceback de Python no imprime filas. */
      error_message: { type: DataTypes.STRING(500), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
  );

  // Se consulta siempre igual: «lo último de esta persona en este inquilino». Un índice que no
  // sigue el orden en que se lee obliga a ordenar en memoria toda la historia de la organización.
  await queryInterface.addIndex({ schema: SCHEMA, tableName: TABLE }, ['_tenant_id', 'actor_user_id', 'created_at'], {
    name: 'idx_data_notebook_history_actor',
  });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.removeIndex({ schema: SCHEMA, tableName: TABLE }, 'idx_data_notebook_history_actor');
  await queryInterface.dropTable({ schema: SCHEMA, tableName: TABLE });
}
