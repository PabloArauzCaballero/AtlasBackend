/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/** Registro de cada carga del artefacto de Flujos: quién, cuándo, qué commit y cuántas filas. */
@Table({ tableName: 'system_flow_imports', schema: atlasSchemaFor('system_flow_imports'), timestamps: false })
export class SystemFlowImportModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare scope: string;

  @Column({ field: 'system_code', type: DataType.STRING(60), allowNull: false })
  declare systemCode: string;

  @Column({ field: 'analyzed_commit', type: DataType.STRING(64) })
  declare analyzedCommit: string | null;

  @Column({ field: 'analyzed_branch', type: DataType.STRING(80) })
  declare analyzedBranch: string | null;

  @Column({ field: 'content_hash', type: DataType.STRING(64) })
  declare contentHash: string | null;

  @Column({ field: 'rows_received', type: DataType.INTEGER, allowNull: false })
  declare rowsReceived: number;

  @Column({ field: 'rows_upserted', type: DataType.INTEGER, allowNull: false })
  declare rowsUpserted: number;

  @Column({ field: 'rows_removed', type: DataType.INTEGER, allowNull: false })
  declare rowsRemoved: number;

  @Column({ field: 'created_by', type: DataType.STRING(80) })
  declare createdBy: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
