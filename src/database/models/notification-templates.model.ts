import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'notification_templates', timestamps: false })
export class NotificationTemplateModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'code', type: DataType.STRING(160), allowNull: false })
  declare code: string;

  @Column({ field: 'channel', type: DataType.STRING(40), allowNull: false })
  declare channel: string;

  @Column({ field: 'locale', type: DataType.STRING(12), allowNull: false })
  declare locale: string;

  @Column({ field: 'title_template', type: DataType.TEXT })
  declare titleTemplate: string | null;

  @Column({ field: 'subject_template', type: DataType.TEXT })
  declare subjectTemplate: string | null;

  @Column({ field: 'body_template', type: DataType.TEXT, allowNull: false })
  declare bodyTemplate: string;

  @Column({ field: 'payload_schema_json', type: DataType.JSONB })
  declare payloadSchemaJson: Record<string, unknown> | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: 'version', type: DataType.INTEGER, allowNull: false })
  declare version: number;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
