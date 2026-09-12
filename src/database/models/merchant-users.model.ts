/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Usuario del comercio afiliado: la CUARTA población autenticable de Atlas, junto a clientes,
 * usuarios internos y usuarios de plataforma.
 *
 * Qué es y qué NO es. Aquí vive la *identidad* de la persona que opera un comercio: quién es, cómo
 * inicia sesión y si sigue habilitada. NO vive aquí a qué comercio pertenece ni qué puede hacer en
 * él: esa membresía es del ERP (`atlas_sales.merchant_users.user_id`, que apunta al `_id` de esta
 * tabla a través del `sub` del token). Son dos tablas con el mismo nombre en dos bases distintas y
 * a propósito responden preguntas distintas — identidad aquí, alcance allá.
 *
 * Por qué existe. El rol `merchant` ya estaba en el vocabulario de tokens y los comercios ya eran
 * un agregado de eventos y notificaciones, pero no había población detrás: el ERP terminaba
 * fabricando el rol de comercio mapeándolo desde `MERCHANT_OPERATIONS`, que es un rol de EMPLEADO
 * de Atlas. Es decir, un comercio no podía iniciar sesión en ninguna parte y lo que el portal
 * llamaba "usuario partner" era, en producción, personal interno.
 */
@Table({ tableName: 'merchant_users', schema: atlasSchemaFor('merchant_users'), timestamps: false })
export class MerchantUserModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'user_code', type: DataType.STRING(60) })
  declare userCode: string | null;

  @Column({ field: 'full_name', type: DataType.STRING(180) })
  declare fullName: string | null;

  @Column({ field: 'email', type: DataType.STRING(180), allowNull: false })
  declare email: string;

  /**
   * Rol dentro del vocabulario de tokens de Atlas. Hoy sólo `merchant`: la granularidad de lo que
   * un comercio puede hacer se decide en el ERP contra su membresía, no aquí.
   */
  @Column({ field: 'role_code', type: DataType.STRING(80), allowNull: false, defaultValue: 'merchant' })
  declare roleCode: string;

  /** `invited` | `active` | `suspended` | `disabled`. Sólo `active` puede iniciar sesión. */
  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false, defaultValue: 'invited' })
  declare status: string;

  @Column({ field: 'phone', type: DataType.STRING(40) })
  declare phone: string | null;

  @Column({ field: 'last_login_at', type: DataType.DATE })
  declare lastLoginAt: Date | null;

  @Column({ field: 'password_changed_at', type: DataType.DATE })
  declare passwordChangedAt: Date | null;

  @Column({ field: 'must_change_password', type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare mustChangePassword: boolean;

  @Column({ field: 'mfa_enabled', type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare mfaEnabled: boolean;

  /** Quién dio de alta esta identidad. El alta es siempre un acto de personal interno. */
  @Column({ field: 'created_by_internal_user_id', type: DataType.BIGINT })
  declare createdByInternalUserId: string | null;

  @Column({ field: 'updated_by_internal_user_id', type: DataType.BIGINT })
  declare updatedByInternalUserId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare deleted: boolean;
}
