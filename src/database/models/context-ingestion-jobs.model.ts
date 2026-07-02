import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_ingestion_jobs', timestamps: false })
export class ContextIngestionJobModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'job_code', type: DataType.STRING(100) })
  declare jobCode: string | null;

  @Column({ field: 'source_type', type: DataType.STRING(60) })
  declare sourceType: string | null;

  @Column({ field: 'source_name', type: DataType.STRING(160) })
  declare sourceName: string | null;

  @Column({ field: 'triggered_by_type', type: DataType.STRING(40) })
  declare triggeredByType: string | null;

  @Column({ field: 'triggered_by_platform_user_id', type: DataType.BIGINT })
  declare triggeredByPlatformUserId: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'finished_at', type: DataType.DATE })
  declare finishedAt: Date | null;

  @Column({ field: 'summary_json', type: DataType.JSONB })
  declare summaryJson: Record<string, unknown> | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
