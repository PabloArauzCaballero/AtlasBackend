import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'contact_verification_attempts', timestamps: false })
export class ContactVerificationAttemptModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'contact_method_id', type: DataType.BIGINT })
  declare contactMethodId: string | null;

  @Column({ field: 'provider_request_id', type: DataType.BIGINT })
  declare providerRequestId: string | null;

  @Column({ field: 'verification_method', type: DataType.STRING(60) })
  declare verificationMethod: string | null;

  @Column({ field: 'verification_status', type: DataType.STRING(40) })
  declare verificationStatus: string | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: 'attempted_at', type: DataType.DATE })
  declare attemptedAt: Date | null;

  @Column({ field: 'verified_at', type: DataType.DATE })
  declare verifiedAt: Date | null;

  @Column({ field: 'failure_reason_code', type: DataType.STRING(80) })
  declare failureReasonCode: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
