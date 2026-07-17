import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'auth_credentials', timestamps: false })
export class AuthCredentialModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(40), allowNull: false })
  declare actorType: string;

  @Column({ field: 'actor_id', type: DataType.BIGINT, allowNull: false })
  declare actorId: string;

  @Column({ field: 'password_hash', type: DataType.TEXT, allowNull: false })
  declare passwordHash: string;

  @Column({ field: 'token_version', type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  declare tokenVersion: number;

  // Fase 4.2: MFA opt-in del cliente. Con `true`, el login exige un OTP de segundo factor por correo.
  @Column({ field: 'mfa_enabled', type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare mfaEnabled: boolean;

  @Column({ field: 'failed_login_attempts', type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare failedLoginAttempts: number;

  @Column({ field: 'locked_until', type: DataType.DATE })
  declare lockedUntil: Date | null;

  @Column({ field: 'last_login_at', type: DataType.DATE })
  declare lastLoginAt: Date | null;

  @Column({ field: 'last_login_ip', type: DataType.STRING(64) })
  declare lastLoginIp: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare deleted: boolean;
}
