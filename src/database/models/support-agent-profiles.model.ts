/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Quién atiende soporte, con qué nivel, en qué horario y cuántas conversaciones aguanta.
 * @system `support.support_agent_profiles`, colgado de `iam.internal_users`: no duplica credenciales.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * La capacidad vive aquí porque aquí se reserva.
 *
 * `activeChannelCount < maxConcurrentChannels` se comprueba y se incrementa en un solo UPDATE
 * condicional: eso es lo que impide que dos agentes se queden con el mismo chat. La presencia
 * (`presenceState`) sí es efímera y puede degradarse sin daño; la capacidad no.
 */
@Table({ tableName: 'support_agent_profiles', schema: atlasSchemaFor('support_agent_profiles'), timestamps: false })
export class SupportAgentProfileModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'internal_user_id', type: DataType.BIGINT, allowNull: false })
  declare internalUserId: string;

  @Column({ field: 'support_level', type: DataType.STRING(20), allowNull: false })
  declare supportLevel: string;

  @Column({ field: 'default_queue_id', type: DataType.BIGINT })
  declare defaultQueueId: string | null;

  @Column({ field: 'timezone', type: DataType.STRING(60), allowNull: false })
  declare timezone: string;

  @Column({ field: 'language_codes_json', type: DataType.JSONB, allowNull: false })
  declare languageCodesJson: string[];

  @Column({ field: 'employment_status', type: DataType.STRING(30), allowNull: false })
  declare employmentStatus: string;

  @Column({ field: 'max_concurrent_channels', type: DataType.INTEGER, allowNull: false })
  declare maxConcurrentChannels: number;

  @Column({ field: 'active_channel_count', type: DataType.INTEGER, allowNull: false })
  declare activeChannelCount: number;

  @Column({ field: 'presence_state', type: DataType.STRING(20), allowNull: false })
  declare presenceState: string;

  @Column({ field: 'presence_changed_at', type: DataType.DATE, allowNull: false })
  declare presenceChangedAt: Date;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
