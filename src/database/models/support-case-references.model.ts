/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business De qué compra, cuota, pago o verificación habla este caso, sin copiar esos datos.
 * @system `support.support_case_references`, puntero tipado a entidades de otros dominios de Atlas.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Se referencia, no se copia.
 *
 * Una copia del estado de la compra dentro del caso envejece en minutos y termina contradiciendo al
 * dominio dueño: el agente lee «pendiente» cuando ya se pagó. El puntero obliga a preguntar a quien
 * sabe, y `snapshotLabel` guarda sólo la etiqueta con la que se vinculó, para poder explicarla si la
 * entidad cambia de nombre.
 */
@Table({ tableName: 'support_case_references', schema: atlasSchemaFor('support_case_references'), timestamps: false })
export class SupportCaseReferenceModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'case_id', type: DataType.BIGINT, allowNull: false })
  declare caseId: string;

  @Column({ field: 'entity_type', type: DataType.STRING(60), allowNull: false })
  declare entityType: string;

  @Column({ field: 'entity_id', type: DataType.STRING(64), allowNull: false })
  declare entityId: string;

  @Column({ field: 'relation_type', type: DataType.STRING(40), allowNull: false })
  declare relationType: string;

  @Column({ field: 'snapshot_label', type: DataType.STRING(200) })
  declare snapshotLabel: string | null;

  @Column({ field: 'created_by_actor_id', type: DataType.STRING(64) })
  declare createdByActorId: string | null;
}
