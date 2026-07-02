import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'provider_health_logs', timestamps: false })
export class ProviderHealthLogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'provider_id', type: DataType.BIGINT, allowNull: false })
  declare providerId: string;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'mode_checked', type: DataType.STRING(30), allowNull: false })
  declare modeChecked: string;

  @Column({ field: 'latency_ms', type: DataType.INTEGER, allowNull: false })
  declare latencyMs: number;

  @Column({ field: 'checked_at', type: DataType.DATE, allowNull: false })
  declare checkedAt: Date;

  @Column({ field: 'error_code', type: DataType.STRING(80) })
  declare errorCode: string | null;

  @Column({ field: 'error_message_safe', type: DataType.TEXT })
  declare errorMessageSafe: string | null;

  @Column({ field: 'metadata_json', type: DataType.JSONB })
  declare metadataJson: Record<string, unknown> | null;
}
