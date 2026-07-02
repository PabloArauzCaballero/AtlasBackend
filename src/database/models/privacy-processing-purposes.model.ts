import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'privacy_processing_purposes', timestamps: false })
export class PrivacyProcessingPurposeModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'purpose_code', type: DataType.STRING(100) })
  declare purposeCode: string | null;

  @Column({ field: 'purpose_name', type: DataType.STRING(180) })
  declare purposeName: string | null;

  @Column({ field: 'legal_basis', type: DataType.STRING(160) })
  declare legalBasis: string | null;

  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'requires_explicit_consent', type: DataType.BOOLEAN })
  declare requiresExplicitConsent: boolean | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
