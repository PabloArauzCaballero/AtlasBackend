/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Conserva cada ajuste manual de la tarjeta de un cliente: quién, por qué, desde cuándo, hasta cuándo y si se revocó. Es la evidencia de por qué alguien tiene una tarjeta que no ganó solo.
 * @system mapea `credit.customer_card_tier_overrides`. A lo sumo UNO sin revocar por cliente (índice único parcial).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'customer_card_tier_overrides', schema: atlasSchemaFor('customer_card_tier_overrides'), timestamps: false })
export class CustomerCardTierOverrideModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'tier_code', type: DataType.STRING(20), allowNull: false })
  declare tierCode: string;

  @Column({ field: 'reason', type: DataType.TEXT, allowNull: false })
  declare reason: string;

  @Column({ field: 'set_by_internal_user_id', type: DataType.BIGINT })
  declare setByInternalUserId: string | null;

  @Column({ field: 'valid_from', type: DataType.DATE, allowNull: false })
  declare validFrom: Date;

  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date | null;

  @Column({ field: 'revoked_at', type: DataType.DATE })
  declare revokedAt: Date | null;

  @Column({ field: 'revoked_by_internal_user_id', type: DataType.BIGINT })
  declare revokedByInternalUserId: string | null;

  @Column({ field: 'revoke_reason', type: DataType.TEXT })
  declare revokeReason: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
