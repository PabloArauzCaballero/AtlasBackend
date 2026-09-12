/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Petición de alta de una identidad de comercio, encolada por el ERP.
 *
 * Es la pieza que separa PEDIR un acceso de CONCEDERLO. El ERP pide —él es quien conoce la relación
 * comercial— y el personal interno concede desde el portal, con los datos de la petición y sin
 * poder cambiarlos: si el correo está mal, se corrige en el ERP y se vuelve a encolar, que es donde
 * el dato es la verdad. Ver la migración `20260906130000` para el porqué completo.
 */
@Table({
  tableName: 'merchant_user_provisioning_requests',
  schema: atlasSchemaFor('merchant_user_provisioning_requests'),
  timestamps: false,
})
export class MerchantUserProvisioningRequestModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'source', type: DataType.STRING(40), allowNull: false, defaultValue: 'erp' })
  declare source: string;

  @Column({ field: 'external_reference', type: DataType.STRING(120), allowNull: false })
  declare externalReference: string;

  @Column({ field: 'account_reference', type: DataType.STRING(120) })
  declare accountReference: string | null;

  @Column({ field: 'account_name', type: DataType.STRING(180) })
  declare accountName: string | null;

  @Column({ field: 'branch_name', type: DataType.STRING(180) })
  declare branchName: string | null;

  @Column({ field: 'email', type: DataType.STRING(180), allowNull: false })
  declare email: string;

  @Column({ field: 'full_name', type: DataType.STRING(180), allowNull: false })
  declare fullName: string;

  @Column({ field: 'phone', type: DataType.STRING(40) })
  declare phone: string | null;

  @Column({ field: 'role_code', type: DataType.STRING(80) })
  declare roleCode: string | null;

  @Column({ field: 'requested_by', type: DataType.STRING(180) })
  declare requestedBy: string | null;

  /**
   * `@Default` explícito además del `DEFAULT now()` de la tabla.
   *
   * Un `allowNull: false` sin defecto en el modelo ANULA el defecto de la columna y el alta muere
   * con «requestedAt cannot be null». Es el mismo fallo que ya se pagó en el ERP con `createdAt`.
   */
  @Column({ field: 'requested_at', type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare requestedAt: Date;

  /** `pending` | `provisioned` | `rejected`. */
  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false, defaultValue: 'pending' })
  declare status: string;

  @Column({ field: 'merchant_user_id', type: DataType.BIGINT })
  declare merchantUserId: string | null;

  @Column({ field: 'decided_at', type: DataType.DATE })
  declare decidedAt: Date | null;

  @Column({ field: 'decided_by_internal_user_id', type: DataType.BIGINT })
  declare decidedByInternalUserId: string | null;

  @Column({ field: 'rejection_reason', type: DataType.STRING(500) })
  declare rejectionReason: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
