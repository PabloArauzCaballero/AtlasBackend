import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'sim_observations', timestamps: false })
export class SimObservationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'phone_number_hash', type: DataType.STRING(128) })
  declare phoneNumberHash: string | null;

  @Column({ field: 'phone_last_4', type: DataType.STRING(4) })
  declare phoneLast4: string | null;

  @Column({ field: 'carrier_name', type: DataType.STRING(80) })
  declare carrierName: string | null;

  @Column({ field: 'sim_type', type: DataType.STRING(40) })
  declare simType: string | null;

  @Column({ field: 'sim_count', type: DataType.INTEGER })
  declare simCount: number | null;

  @Column({ field: 'phone_line_tenure_months', type: DataType.INTEGER })
  declare phoneLineTenureMonths: number | null;

  @Column({ field: 'last_sim_swap_at', type: DataType.DATE })
  declare lastSimSwapAt: Date | null;

  @Column({ field: 'sim_swap_days_since', type: DataType.INTEGER })
  declare simSwapDaysSince: number | null;

  @Column({ field: 'source_type', type: DataType.STRING(60) })
  declare sourceType: string | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: 'captured_at', type: DataType.DATE })
  declare capturedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
