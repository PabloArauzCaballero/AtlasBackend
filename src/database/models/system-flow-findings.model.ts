/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/** Un hallazgo de los detectores de Flujos (deriva de contrato, escritura pública, huérfano…). */
@Table({ tableName: 'system_flow_findings', schema: atlasSchemaFor('system_flow_findings'), timestamps: false })
export class SystemFlowFindingModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'finding_key', type: DataType.STRING(64), allowNull: false, unique: true })
  declare findingKey: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare kind: string;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare severity: string;

  @Column({ field: 'system_code', type: DataType.STRING(60), allowNull: false })
  declare systemCode: string;

  @Column({ type: DataType.STRING(400), allowNull: false })
  declare ref: string;

  @Column({ type: DataType.STRING(120) })
  declare module: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare summary: string;

  @Column({ field: 'extra_json', type: DataType.JSONB, allowNull: false })
  declare extraJson: Record<string, unknown>;

  @Column({ field: 'known_since', type: DataType.STRING(300) })
  declare knownSince: string | null;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'import_id', type: DataType.BIGINT })
  declare importId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
