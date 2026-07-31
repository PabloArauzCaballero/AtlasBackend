/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'data_quality_issues', schema: atlasSchemaFor('data_quality_issues'), timestamps: false })
export class DataQualityIssueModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'quality_rule_id', type: DataType.BIGINT })
  declare qualityRuleId: string | null;

  @Column({ field: 'target_table', type: DataType.STRING(120) })
  declare targetTable: string | null;

  @Column({ field: 'target_record_id', type: DataType.STRING(120) })
  declare targetRecordId: string | null;

  @Column({ field: 'issue_status', type: DataType.STRING(40) })
  declare issueStatus: string | null;

  @Column({ field: 'detected_at', type: DataType.DATE })
  declare detectedAt: Date | null;

  @Column({ field: 'resolved_at', type: DataType.DATE })
  declare resolvedAt: Date | null;

  @Column({ field: 'resolution_notes', type: DataType.TEXT })
  declare resolutionNotes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
