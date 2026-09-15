/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Un segmento guardado («mora temprana en La Paz») que operaciones reutiliza entre campañas.
 * @system `notification_audience_segments` guarda sólo la DEFINICIÓN (reglas); los miembros se
 *   resuelven al estimar y al materializar una campaña, nunca se copian aquí.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'notification_audience_segments', schema: atlasSchemaFor('notification_audience_segments'), timestamps: false })
export class NotificationAudienceSegmentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'name', type: DataType.STRING(140), allowNull: false })
  declare name: string;

  @Column({ field: 'description', type: DataType.STRING(400) })
  declare description: string | null;

  @Column({ field: 'definition_json', type: DataType.JSONB, allowNull: false })
  declare definitionJson: Record<string, unknown>;

  @Column({ field: 'last_estimate_json', type: DataType.JSONB })
  declare lastEstimateJson: Record<string, unknown> | null;

  @Column({ field: 'last_estimated_at', type: DataType.DATE })
  declare lastEstimatedAt: Date | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'created_by', type: DataType.STRING(120) })
  declare createdBy: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
