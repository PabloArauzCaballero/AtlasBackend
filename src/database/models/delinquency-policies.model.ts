/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda, con fecha de vigencia, lo que se le dijo al cliente que pasaría si se atrasa.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * La política de mora, versionada.
 *
 * Vive en la base y no en la app porque es la promesa que se le opone al cliente cuando reclama: un
 * texto que cambia con cada publicación de la app no tiene fecha ni versión, y entonces nadie puede
 * decir bajo qué reglas compró alguien en marzo.
 */
@Table({ tableName: 'delinquency_policies', schema: atlasSchemaFor('delinquency_policies'), timestamps: false })
export class DelinquencyPolicyModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'policy_code', type: DataType.STRING(80), allowNull: false })
  declare policyCode: string;

  @Column({ field: 'version_code', type: DataType.STRING(40), allowNull: false })
  declare versionCode: string;

  @Column({ field: 'language', type: DataType.STRING(10), allowNull: false })
  declare language: string;

  @Column({ field: 'title', type: DataType.STRING(200), allowNull: false })
  declare title: string;

  @Column({ field: 'summary', type: DataType.TEXT, allowNull: false })
  declare summary: string;

  @Column({ field: 'body_md', type: DataType.TEXT, allowNull: false })
  declare bodyMd: string;

  /** `regulatorio` o `atlas`: lo que manda la norma frente a lo que decide la casa. */
  @Column({ field: 'source_kind', type: DataType.STRING(20), allowNull: false })
  declare sourceKind: string;

  @Column({ field: 'source_reference', type: DataType.STRING(300) })
  declare sourceReference: string | null;

  @Column({ field: 'stages_json', type: DataType.JSONB, allowNull: false })
  declare stagesJson: unknown;

  @Column({ field: 'effective_from', type: DataType.DATEONLY, allowNull: false })
  declare effectiveFrom: string;

  @Column({ field: 'effective_until', type: DataType.DATEONLY })
  declare effectiveUntil: string | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
