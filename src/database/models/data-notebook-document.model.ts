/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { NOTEBOOK_CELL_LANGUAGES } from '../../modules/data-notebook/data-notebook.constants.js';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Una celda tal como se guarda: lo que se escribió y lo que arrojó la última vez.
 *
 * El lenguaje sale de `NOTEBOOK_CELL_LANGUAGES` y no de una lista escrita otra vez aquí: el
 * esquema de entrada y la fila tienen que admitir exactamente lo mismo, y cuando eran dos listas
 * la segunda se quedó atrás al añadir R —el `POST` validaba, y el tipo de la fila decía que no—.
 * Ninguno de esos lenguajes se ejecuta en el servidor: esta columna se escribe y se lee.
 */
export type StoredNotebookCell = {
  kind: 'code' | 'markdown';
  language: (typeof NOTEBOOK_CELL_LANGUAGES)[number];
  source: string;
  outcome?: Record<string, unknown> | null;
};

/**
 * Un cuaderno guardado por una persona, con su avance.
 *
 * `cells` lleva también el resultado de cada celda —tabla, valor, registro y gráficos—, y eso
 * significa que aquí dentro hay filas de clientes: las ENMASCARADAS que sirvió `read_api`, nunca
 * el dato en claro. Es una copia fuera de aquella superficie, así que el servicio impone un techo
 * de bytes y la pantalla rotula cada resultado con su fecha al restaurarlo.
 *
 * Lo que sigue sin existir es una vía de ejecución: esta tabla se escribe y se lee, y nada de su
 * contenido se interpreta en el servidor.
 */
@Table({
  tableName: 'data_notebook_documents',
  schema: atlasSchemaFor('data_notebook_documents'),
  timestamps: false,
})
export class DataNotebookDocumentModel extends Model {
  @Column({
    field: '_id',
    type: DataType.BIGINT,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
  })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'owner_user_id', type: DataType.STRING(80), allowNull: false })
  declare ownerUserId: string;

  @Column({ type: DataType.STRING(160), allowNull: false })
  declare title: string;

  @Column({ field: 'dataset_code', type: DataType.STRING(128) })
  declare datasetCode: string | null;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare cells: StoredNotebookCell[];

  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ field: 'updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
