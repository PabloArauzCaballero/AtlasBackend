import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'auth_one_time_codes', timestamps: false })
export class AuthOneTimeCodeModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(40), allowNull: false })
  declare actorType: string;

  @Column({ field: 'actor_id', type: DataType.BIGINT, allowNull: false })
  declare actorId: string;

  @Column({ field: 'purpose', type: DataType.STRING(40), allowNull: false })
  declare purpose: string;

  @Column({ field: 'code_hash', type: DataType.STRING(128), allowNull: false })
  declare codeHash: string;

  @Column({ field: 'challenge_hash', type: DataType.STRING(128) })
  declare challengeHash: string | null;

  @Column({ field: 'expires_at', type: DataType.DATE, allowNull: false })
  declare expiresAt: Date;

  @Column({ field: 'consumed_at', type: DataType.DATE })
  declare consumedAt: Date | null;

  @Column({ field: 'attempts', type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare attempts: number;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
