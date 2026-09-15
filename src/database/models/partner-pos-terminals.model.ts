/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El terminal de cobro, que pertenece a una SUCURSAL y no al comercio.
 *
 * Un POS está físicamente en un sitio; colgarlo del comercio haría imposible responder «¿en qué
 * local se hizo este cobro?», que es la primera pregunta de cualquier investigación de fraude
 * presencial.
 *
 * El serial es único por TENANT y no por sucursal: mover un terminal de local es normal, que el
 * mismo serial exista dos veces a la vez no lo es — sería la forma más simple de duplicar cobros
 * sin que nada lo delate. Los retirados quedan fuera del índice para poder dar de alta un equipo
 * reacondicionado con el mismo serial.
 */
@Table({ tableName: 'partner_pos_terminals', schema: atlasSchemaFor('partner_pos_terminals'), timestamps: false })
export class PartnerPosTerminalModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'partner_profile_id', type: DataType.BIGINT, allowNull: false })
  declare partnerProfileId: string;

  @Column({ field: 'branch_id', type: DataType.BIGINT, allowNull: false })
  declare branchId: string;

  @Column({ field: 'terminal_serial', type: DataType.STRING(80), allowNull: false })
  declare terminalSerial: string;

  @Column({ field: 'terminal_alias', type: DataType.STRING(120) })
  declare terminalAlias: string | null;

  @Column({ field: 'provider', type: DataType.STRING(80) })
  declare provider: string | null;

  @Column({ field: 'model', type: DataType.STRING(80) })
  declare model: string | null;

  /** `registered` | `active` | `suspended` | `retired`. */
  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'activated_at', type: DataType.DATE })
  declare activatedAt: Date | null;

  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
