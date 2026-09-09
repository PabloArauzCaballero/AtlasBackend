/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Un flujo derivado del código: una fila por operación HTTP de un bloque (nivel 2 de Flujos).
 * Es caché regenerable del artefacto de `flows:derive`; no lleva borrado lógico a propósito.
 */
@Table({ tableName: 'system_flow_catalog', schema: atlasSchemaFor('system_flow_catalog'), timestamps: false })
export class SystemFlowCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'flow_id', type: DataType.STRING(40), allowNull: false, unique: true })
  declare flowId: string;

  @Column({ type: DataType.STRING(220), allowNull: false })
  declare slug: string;

  @Column({ field: 'system_code', type: DataType.STRING(60), allowNull: false })
  declare systemCode: string;

  @Column({ type: DataType.STRING(220), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare module: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare kind: string;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare risk: string;

  @Column({ field: 'risk_basis', type: DataType.STRING(40), allowNull: false })
  declare riskBasis: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare badges: string[];

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare discovery: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare verification: string;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare freshness: string;

  @Column({ field: 'http_method', type: DataType.STRING(10), allowNull: false })
  declare httpMethod: string;

  @Column({ type: DataType.STRING(400), allowNull: false })
  declare path: string;

  @Column({ type: DataType.STRING(160), allowNull: false })
  declare controller: string;

  @Column({ type: DataType.STRING(160), allowNull: false })
  declare handler: string;

  @Column({ field: 'source_file', type: DataType.STRING(300) })
  declare sourceFile: string | null;

  @Column({ field: 'source_line', type: DataType.INTEGER })
  declare sourceLine: number | null;

  @Column({ field: 'is_public', type: DataType.BOOLEAN, allowNull: false })
  declare isPublic: boolean;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare roles: string[];

  @Column({ field: 'internal_permissions', type: DataType.JSONB, allowNull: false })
  declare internalPermissions: string[];

  @Column({ type: DataType.JSONB, allowNull: false })
  declare guards: string[];

  @Column({ type: DataType.JSONB, allowNull: false })
  declare callers: string[];

  @Column({ field: 'test_status', type: DataType.STRING(12), allowNull: false })
  declare testStatus: string;

  @Column({ field: 'contract_status', type: DataType.STRING(16), allowNull: false })
  declare contractStatus: string;

  @Column({ field: 'analysis_json', type: DataType.JSONB, allowNull: false })
  declare analysisJson: Record<string, unknown>;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare reads: string[];

  @Column({ type: DataType.JSONB, allowNull: false })
  declare writes: string[];

  @Column({ field: 'verified_at', type: DataType.DATE })
  declare verifiedAt: Date | null;

  @Column({ field: 'verified_by', type: DataType.STRING(80) })
  declare verifiedBy: string | null;

  @Column({ field: 'verification_evidence_json', type: DataType.JSONB, allowNull: false })
  declare verificationEvidenceJson: Record<string, unknown>;

  @Column({ field: 'findings_count', type: DataType.INTEGER, allowNull: false })
  declare findingsCount: number;

  @Column({ field: 'analyzed_commit', type: DataType.STRING(64) })
  declare analyzedCommit: string | null;

  @Column({ field: 'analyzed_branch', type: DataType.STRING(80) })
  declare analyzedBranch: string | null;

  @Column({ field: 'import_id', type: DataType.BIGINT })
  declare importId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
