/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business La cola de trabajo de soporte: a quién sirve, qué competencias exige y qué promete.
 * @system `support.support_queues`, con desbordamiento a otra cola cuando la propia no da abasto.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Una cola no es una etiqueta: es la frontera de autorización del soporte.
 *
 * `contextType` decide si por aquí pasan consumidores o comercios, y `skillsRequiredJson` decide
 * quién puede tomarlos. Sin cola, «asignar a cualquier agente disponible» significa que el agente
 * de fraude puede terminar leyendo una consulta de facturación y al revés.
 */
@Table({ tableName: 'support_queues', schema: atlasSchemaFor('support_queues'), timestamps: false })
export class SupportQueueModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'queue_code', type: DataType.STRING(60), allowNull: false })
  declare queueCode: string;

  @Column({ field: 'name', type: DataType.STRING(160), allowNull: false })
  declare name: string;

  @Column({ field: 'description', type: DataType.STRING(400) })
  declare description: string | null;

  @Column({ field: 'context_type', type: DataType.STRING(30), allowNull: false })
  declare contextType: string;

  @Column({ field: 'skills_required_json', type: DataType.JSONB, allowNull: false })
  declare skillsRequiredJson: string[];

  @Column({ field: 'business_hours_json', type: DataType.JSONB })
  declare businessHoursJson: Record<string, unknown> | null;

  @Column({ field: 'default_priority', type: DataType.STRING(4), allowNull: false })
  declare defaultPriority: string;

  @Column({ field: 'sla_policy_code', type: DataType.STRING(60) })
  declare slaPolicyCode: string | null;

  @Column({ field: 'overflow_queue_id', type: DataType.BIGINT })
  declare overflowQueueId: string | null;

  @Column({ field: 'display_order', type: DataType.INTEGER, allowNull: false })
  declare displayOrder: number;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
