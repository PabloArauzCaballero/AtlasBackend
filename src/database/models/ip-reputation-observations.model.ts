import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'ip_reputation_observations', timestamps: false })
export class IpReputationObservationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'provider_request_id', type: DataType.BIGINT })
  declare providerRequestId: string | null;

  @Column({ field: 'ip_address', type: DataType.INET })
  declare ipAddress: string | null;

  @Column({ field: 'is_vpn', type: DataType.BOOLEAN })
  declare isVpn: boolean | null;

  @Column({ field: 'is_proxy', type: DataType.BOOLEAN })
  declare isProxy: boolean | null;

  @Column({ field: 'is_tor', type: DataType.BOOLEAN })
  declare isTor: boolean | null;

  @Column({ field: 'country_code', type: DataType.STRING(3) })
  declare countryCode: string | null;

  @Column({ field: 'city', type: DataType.STRING(120) })
  declare city: string | null;

  @Column({ field: 'reputation_score', type: DataType.DECIMAL(5, 2) })
  declare reputationScore: string | null;

  @Column({ field: 'captured_at', type: DataType.DATE })
  declare capturedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
