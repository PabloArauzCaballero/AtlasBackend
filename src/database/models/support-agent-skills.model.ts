/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Qué sabe atender cada agente y hasta cuándo vale esa habilitación.
 * @system `support.support_agent_skills`, con nivel de competencia y vigencia por habilidad.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * La habilidad tiene VIGENCIA, no sólo existencia.
 *
 * Habilitar a alguien para atender fraude o privacidad es una decisión que caduca: quien dejó el
 * equipo hace seis meses no debe seguir siendo elegible porque nadie se acordó de quitarle la fila.
 * `validUntil` hace que el olvido cierre la puerta en vez de dejarla abierta.
 */
@Table({ tableName: 'support_agent_skills', schema: atlasSchemaFor('support_agent_skills'), timestamps: false })
export class SupportAgentSkillModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'agent_profile_id', type: DataType.BIGINT, allowNull: false })
  declare agentProfileId: string;

  @Column({ field: 'skill_code', type: DataType.STRING(60), allowNull: false })
  declare skillCode: string;

  @Column({ field: 'competency_level', type: DataType.INTEGER, allowNull: false })
  declare competencyLevel: number;

  @Column({ field: 'valid_from', type: DataType.DATE, allowNull: false })
  declare validFrom: Date;

  @Column({ field: 'valid_until', type: DataType.DATE })
  declare validUntil: Date | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
