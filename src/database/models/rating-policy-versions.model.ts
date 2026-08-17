/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'rating_policy_versions', schema: atlasSchemaFor('rating_policy_versions'), timestamps: false })
export class RatingPolicyVersionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  /** `null` = política de plataforma: rige para todo tenant que no tenga una propia. */
  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'policy_code', type: DataType.STRING(80), allowNull: false })
  declare policyCode: string;

  @Column({ field: 'version_code', type: DataType.STRING(40), allowNull: false })
  declare versionCode: string;

  @Column({ field: 'scale_code', type: DataType.STRING(40), allowNull: false })
  declare scaleCode: string;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'effective_from', type: DataType.DATE, allowNull: false })
  declare effectiveFrom: Date;

  @Column({ field: 'effective_until', type: DataType.DATE })
  declare effectiveUntil: Date | null;

  @Column({ field: 'contamination_enabled', type: DataType.BOOLEAN, allowNull: false })
  declare contaminationEnabled: boolean;

  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'approved_by_platform_user_id', type: DataType.BIGINT })
  declare approvedByPlatformUserId: string | null;

  @Column({ field: 'approved_at', type: DataType.DATE })
  declare approvedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
