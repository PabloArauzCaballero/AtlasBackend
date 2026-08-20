/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El local del comercio: dónde está físicamente.
 *
 * Existe aquí —y no sólo en el ERP— porque es de lo que cuelgan el QR y los terminales, y las dos
 * cosas son evidencia: un cobro ocurre EN un sitio. `erp_branch_id` amarra esta sucursal con la que
 * el ERP ya registra, para que no haya dos verdades sobre el mismo local.
 */
@Table({ tableName: 'partner_branches', schema: atlasSchemaFor('partner_branches'), timestamps: false })
export class PartnerBranchModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'partner_profile_id', type: DataType.BIGINT, allowNull: false })
  declare partnerProfileId: string;

  @Column({ field: 'branch_code', type: DataType.STRING(40), allowNull: false })
  declare branchCode: string;

  @Column({ field: 'name', type: DataType.STRING(200), allowNull: false })
  declare name: string;

  @Column({ field: 'address_line', type: DataType.STRING(300) })
  declare addressLine: string | null;

  @Column({ field: 'city', type: DataType.STRING(120) })
  declare city: string | null;

  @Column({ field: 'latitude', type: DataType.DECIMAL(10, 7) })
  declare latitude: string | null;

  @Column({ field: 'longitude', type: DataType.DECIMAL(10, 7) })
  declare longitude: string | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'erp_branch_id', type: DataType.STRING(64) })
  declare erpBranchId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
