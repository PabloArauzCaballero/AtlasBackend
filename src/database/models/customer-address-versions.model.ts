import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_address_versions', timestamps: false })
export class CustomerAddressVersionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_address_id', type: DataType.BIGINT })
  declare customerAddressId: string | null;

  @Column({ field: 'declared_address_text', type: DataType.TEXT })
  declare declaredAddressText: string | null;

  @Column({ field: 'normalized_address_text', type: DataType.TEXT })
  declare normalizedAddressText: string | null;

  @Column({ field: 'declared_zone_name', type: DataType.STRING(120) })
  declare declaredZoneName: string | null;

  @Column({ field: 'city', type: DataType.STRING(120) })
  declare city: string | null;

  @Column({ field: 'department', type: DataType.STRING(80) })
  declare department: string | null;

  @Column({ field: 'country_code', type: DataType.STRING(3) })
  declare countryCode: string | null;

  @Column({ field: 'geo_zone_code_snapshot', type: DataType.STRING(80) })
  declare geoZoneCodeSnapshot: string | null;

  @Column({ field: 'geo_zone_name_snapshot', type: DataType.STRING(180) })
  declare geoZoneNameSnapshot: string | null;

  @Column({ field: 'evidence_id', type: DataType.BIGINT })
  declare evidenceId: string | null;

  @Column({ field: 'source_type', type: DataType.STRING(60) })
  declare sourceType: string | null;

  @Column({ field: 'verification_status', type: DataType.STRING(40) })
  declare verificationStatus: string | null;

  @Column({ field: 'verifiability_band', type: DataType.STRING(40) })
  declare verifiabilityBand: string | null;

  @Column({ field: 'valid_from', type: DataType.DATE })
  declare validFrom: Date | null;

  @Column({ field: 'valid_until', type: DataType.DATE })
  declare validUntil: Date | null;

  @Column({ field: 'supersedes_version_id', type: DataType.BIGINT })
  declare supersedesVersionId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
