import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_profile_versions', timestamps: false })
export class CustomerProfileVersionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'first_name', type: DataType.STRING(120) })
  declare firstName: string | null;

  @Column({ field: 'last_name', type: DataType.STRING(120) })
  declare lastName: string | null;

  @Column({ field: 'full_name_normalized', type: DataType.STRING(260) })
  declare fullNameNormalized: string | null;

  @Column({ field: 'birth_date', type: DataType.DATEONLY })
  declare birthDate: string | null;

  @Column({ field: 'age_at_capture', type: DataType.INTEGER })
  declare ageAtCapture: number | null;

  @Column({ field: 'gender_declared', type: DataType.STRING(30) })
  declare genderDeclared: string | null;

  @Column({ field: 'preferred_language', type: DataType.STRING(10) })
  declare preferredLanguage: string | null;

  @Column({ field: 'marketing_opt_in', type: DataType.BOOLEAN })
  declare marketingOptIn: boolean | null;

  @Column({ field: 'source_type', type: DataType.STRING(60) })
  declare sourceType: string | null;

  @Column({ field: 'valid_from', type: DataType.DATE })
  declare validFrom: Date | null;

  @Column({ field: 'valid_until', type: DataType.DATE })
  declare validUntil: Date | null;

  @Column({ field: 'supersedes_version_id', type: DataType.BIGINT })
  declare supersedesVersionId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
