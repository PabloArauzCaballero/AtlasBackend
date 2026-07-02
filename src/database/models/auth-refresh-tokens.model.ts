import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'auth_refresh_tokens', timestamps: false })
export class AuthRefreshTokenModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(40), allowNull: false })
  declare actorType: string;

  @Column({ field: 'actor_id', type: DataType.BIGINT, allowNull: false })
  declare actorId: string;

  @Column({ field: 'token_hash', type: DataType.STRING(128), allowNull: false })
  declare tokenHash: string;

  @Column({ field: 'issued_at', type: DataType.DATE, allowNull: false })
  declare issuedAt: Date;

  @Column({ field: 'expires_at', type: DataType.DATE, allowNull: false })
  declare expiresAt: Date;

  @Column({ field: 'revoked_at', type: DataType.DATE })
  declare revokedAt: Date | null;

  @Column({ field: 'revoked_reason', type: DataType.STRING(80) })
  declare revokedReason: string | null;

  @Column({ field: 'replaced_by_token_id', type: DataType.BIGINT })
  declare replacedByTokenId: string | null;

  @Column({ field: 'user_agent', type: DataType.STRING(255) })
  declare userAgent: string | null;

  @Column({ field: 'ip_address', type: DataType.STRING(64) })
  declare ipAddress: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
