import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'data_subject_requests', timestamps: false })
export class DataSubjectRequestModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'request_code', type: DataType.STRING(80) })
  declare requestCode: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'request_type', type: DataType.STRING(60) })
  declare requestType: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'requested_at', type: DataType.DATE })
  declare requestedAt: Date | null;

  @Column({ field: 'due_at', type: DataType.DATE })
  declare dueAt: Date | null;

  @Column({ field: 'resolved_at', type: DataType.DATE })
  declare resolvedAt: Date | null;

  @Column({ field: 'handled_by', type: DataType.BIGINT })
  declare handledBy: string | null;

  @Column({ field: 'resolution_notes', type: DataType.TEXT })
  declare resolutionNotes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
