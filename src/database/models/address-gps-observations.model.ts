import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'address_gps_observations', timestamps: false })
export class AddressGpsObservationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'customer_address_id', type: DataType.BIGINT })
  declare customerAddressId: string | null;

  @Column({ field: 'address_version_id', type: DataType.BIGINT })
  declare addressVersionId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'gps_lat', type: DataType.DECIMAL(10, 7) })
  declare gpsLat: string | null;

  @Column({ field: 'gps_lng', type: DataType.DECIMAL(10, 7) })
  declare gpsLng: string | null;

  @Column({ field: 'gps_accuracy_meters', type: DataType.DECIMAL(8, 2) })
  declare gpsAccuracyMeters: string | null;

  @Column({ field: 'match_score_against_declared_address', type: DataType.DECIMAL(5, 2) })
  declare matchScoreAgainstDeclaredAddress: string | null;

  @Column({ field: 'distance_to_declared_meters', type: DataType.DECIMAL(12, 2) })
  declare distanceToDeclaredMeters: string | null;

  @Column({ field: 'captured_at', type: DataType.DATE })
  declare capturedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
