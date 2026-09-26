/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza impide que un evento viejo de otro servicio, reentregado tarde, revierta uno nuevo.
 * @system `external_aggregate_versions` (P-14): última versión aplicada por (productor, agregado).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'external_aggregate_versions', schema: atlasSchemaFor('external_aggregate_versions'), timestamps: false })
export class ExternalAggregateVersionModel extends Model {
  @Column({ field: 'producer', type: DataType.STRING(40), primaryKey: true, allowNull: false })
  declare producer: string;

  @Column({ field: 'aggregate_type', type: DataType.STRING(80), primaryKey: true, allowNull: false })
  declare aggregateType: string;

  @Column({ field: 'aggregate_id', type: DataType.STRING(120), primaryKey: true, allowNull: false })
  declare aggregateId: string;

  @Column({ field: 'last_version', type: DataType.BIGINT, allowNull: false })
  declare lastVersion: string;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
