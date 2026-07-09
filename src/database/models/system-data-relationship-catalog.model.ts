import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { SystemDataEntityCatalogModel } from './system-data-entity-catalog.model.js';

@Table({ tableName: 'system_data_relationship_catalog', timestamps: false })
export class SystemDataRelationshipCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @ForeignKey(() => SystemDataEntityCatalogModel)
  @Column({ field: 'source_data_entity_id', type: DataType.BIGINT })
  declare sourceDataEntityId: string | null;

  @ForeignKey(() => SystemDataEntityCatalogModel)
  @Column({ field: 'target_data_entity_id', type: DataType.BIGINT })
  declare targetDataEntityId: string | null;

  @Column({ field: 'source_schema', type: DataType.STRING(120), allowNull: false })
  declare sourceSchema: string;

  @Column({ field: 'source_table', type: DataType.STRING(180), allowNull: false })
  declare sourceTable: string;

  @Column({ field: 'source_column', type: DataType.STRING(180) })
  declare sourceColumn: string | null;

  @Column({ field: 'target_schema', type: DataType.STRING(120), allowNull: false })
  declare targetSchema: string;

  @Column({ field: 'target_table', type: DataType.STRING(180), allowNull: false })
  declare targetTable: string;

  @Column({ field: 'target_column', type: DataType.STRING(180) })
  declare targetColumn: string | null;

  @Column({ field: 'relationship_type', type: DataType.STRING(80), allowNull: false })
  declare relationshipType: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare cardinality: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare optionality: string;

  @Column({ field: 'business_reason', type: DataType.TEXT })
  declare businessReason: string | null;

  @Column({ field: 'technical_reason', type: DataType.TEXT })
  declare technicalReason: string | null;

  @Column({ field: 'audit_usage', type: DataType.TEXT })
  declare auditUsage: string | null;

  @Column({ field: 'analysis_usage', type: DataType.TEXT })
  declare analysisUsage: string | null;

  @Column({ field: 'decision_usage', type: DataType.TEXT })
  declare decisionUsage: string | null;

  @Column({ field: 'enforcement_strategy', type: DataType.STRING(80) })
  declare enforcementStrategy: string | null;

  @Column({ field: 'delete_policy', type: DataType.STRING(80) })
  declare deletePolicy: string | null;

  @Column({ field: 'source_document', type: DataType.STRING(120), allowNull: false })
  declare sourceDocument: string;

  @Column({ field: 'confidence_level', type: DataType.STRING(20), allowNull: false })
  declare confidenceLevel: string;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
