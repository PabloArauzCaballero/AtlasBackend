/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda una parte de las corridas QA de N personas (motor de journeys).
 * @system el módulo `qa-orchestration` escribe por SQL con fencing; el modelo deja la tabla con
 *   dueño en el inventario del ORM (AT-018).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'qa_run_plans', schema: atlasSchemaFor('qa_run_plans'), timestamps: false })
export class QaRunPlanModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'operator_id', type: DataType.STRING(120), allowNull: false })
  declare operatorId: string;

  @Column({ field: 'plan_hash', type: DataType.CHAR(64), allowNull: false })
  declare planHash: string;

  @Column({ field: 'plan_json', type: DataType.JSONB, allowNull: false })
  declare planJson: unknown;

  @Column({ field: 'expires_at', type: DataType.DATE, allowNull: false })
  declare expiresAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
}
