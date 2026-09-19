/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('data_notebook_documents');
const TABLE = 'data_notebook_documents';

/**
 * Los cuadernos GUARDADOS: el documento que alguien escribió, no el rastro de lo que ejecutó.
 *
 * Convive con `data_notebook_query_history` y no lo sustituye, porque responden a preguntas
 * distintas: el historial es trazabilidad —qué se preguntó, cuándo y con qué coste, sin poder
 * borrarse— y esto es el trabajo de una persona, que se edita y se tira. Meterlos en la misma
 * tabla habría obligado a elegir: o el análisis en curso queda congelado como evidencia, o la
 * evidencia se puede borrar editando un cuaderno.
 *
 * `cells` es JSONB con el documento entero Y el avance: lo que cada celda arrojó la última vez. Sí
 * hay, por tanto, filas de clientes aquí dentro —las ENMASCARADAS de `read_api`, nunca el dato en
 * claro—, y por eso el servicio impone un techo de bytes y la pantalla rotula con su fecha cada
 * resultado restaurado. Se eligió así porque un cuaderno que se reabre en blanco no conserva el
 * trabajo; el historial de al lado sigue guardando sólo la pregunta, que es lo que hace de
 * evidencia.
 *
 * El dueño es `owner_user_id` y no hay columna de «compartido»: hoy un cuaderno es de quien lo
 * escribe. Compartirlo es una capacidad distinta —quién puede ver el trabajo de quién— y merece su
 * propio permiso y su propio registro, no una columna añadida aquí de paso.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.createTable(
    { schema: SCHEMA, tableName: TABLE },
    {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
      owner_user_id: { type: DataTypes.STRING(80), allowNull: false },
      title: { type: DataTypes.STRING(160), allowNull: false },
      /** Dataset con el que se estaba trabajando, para reabrir el cuaderno donde se dejó. */
      dataset_code: { type: DataTypes.STRING(128), allowNull: true },
      /** El documento: celdas con su tipo, lenguaje y texto. Nunca resultados. */
      cells: { type: DataTypes.JSONB, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
  );

  // Se lee siempre igual: «mis cuadernos, el más reciente arriba».
  await queryInterface.addIndex({ schema: SCHEMA, tableName: TABLE }, ['_tenant_id', 'owner_user_id', 'updated_at'], {
    name: 'idx_data_notebook_documents_owner',
  });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.removeIndex({ schema: SCHEMA, tableName: TABLE }, 'idx_data_notebook_documents_owner');
  await queryInterface.dropTable({ schema: SCHEMA, tableName: TABLE });
}
