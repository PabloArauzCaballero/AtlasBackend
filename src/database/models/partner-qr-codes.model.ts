/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Los dos QR del comercio: el suyo y el de su cuenta bancaria.
 *
 * **Se guarda la EVIDENCIA, no el dato transcrito.** Se conserva el objeto subido y su `sha256`, no
 * sólo el número que alguien tecleó. Un QR de cobro dice a qué cuenta va el dinero: aceptar el
 * número transcrito y tirar la imagen deja al sistema sin nada que oponer el día que el comercio
 * afirme que él nunca puso esa cuenta.
 *
 * **Un QR no se edita: se reemplaza.** `status` y `replacedById` conservan el anterior. Si un cobro
 * salió mal hay que poder reconstruir contra qué QR se cobró ese día, y un UPDATE en sitio destruye
 * exactamente eso.
 *
 * **El bancario apunta al padrón de ASFI** por su sigla, que es lo que permite frenar un cobro
 * contra una entidad sin licencia vigente sin inventar una tabla de traducción.
 */
@Table({ tableName: 'partner_qr_codes', schema: atlasSchemaFor('partner_qr_codes'), timestamps: false })
export class PartnerQrCodeModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'partner_profile_id', type: DataType.BIGINT, allowNull: false })
  declare partnerProfileId: string;

  /** Nulo = QR de toda la empresa. Con sucursal = el QR de ese local. */
  @Column({ field: 'branch_id', type: DataType.BIGINT })
  declare branchId: string | null;

  /** `business` | `bank`. */
  @Column({ field: 'qr_kind', type: DataType.STRING(20), allowNull: false })
  declare qrKind: string;

  @Column({ field: 'storage_key', type: DataType.STRING(400), allowNull: false })
  declare storageKey: string;

  @Column({ field: 'content_type', type: DataType.STRING(60), allowNull: false })
  declare contentType: string;

  @Column({ field: 'size_bytes', type: DataType.INTEGER, allowNull: false })
  declare sizeBytes: number;

  /** Del contenido real descargado, no del que declaró quien subió. */
  @Column({ field: 'sha256', type: DataType.CHAR(64), allowNull: false })
  declare sha256: string;

  @Column({ field: 'bank_institution_code', type: DataType.STRING(16) })
  declare bankInstitutionCode: string | null;

  /** Enmascarada siempre: el expediente prueba de quién es la cuenta, no necesita operarla. */
  @Column({ field: 'account_number_masked', type: DataType.STRING(40) })
  declare accountNumberMasked: string | null;

  /** `pending_review` | `active` | `rejected` | `replaced`. */
  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'verified_at', type: DataType.DATE })
  declare verifiedAt: Date | null;

  @Column({ field: 'replaced_by_id', type: DataType.BIGINT })
  declare replacedById: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
