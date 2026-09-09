/**
 * @file Modelo Sequelize: el contrato legal por defecto de un inquilino.
 * @business Es el texto bajo el que opera un comercio al que nadie le negoció uno propio.
 * @system mapea `partner.partner_contract_templates`, versionado y con un solo predeterminado vigente.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El contrato NO se edita: se versiona.
 *
 * Un contrato es la evidencia de a qué se comprometió alguien un día concreto. Editar el cuerpo en
 * sitio borraría el texto que un comercio aceptó de verdad y dejaría su expediente afirmando algo
 * que ya no se puede comprobar. Por eso el servicio sólo da de alta versiones nuevas y archiva la
 * anterior; la fila vieja se queda como prueba de qué regía cada día.
 */
@Table({
  tableName: 'partner_contract_templates',
  schema: atlasSchemaFor('partner_contract_templates'),
  timestamps: false,
})
export class PartnerContractTemplateModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  /** Estable entre versiones: es lo que identifica «el mismo contrato» a lo largo del tiempo. */
  @Column({ field: 'template_code', type: DataType.STRING(60), allowNull: false })
  declare templateCode: string;

  @Column({ field: 'name', type: DataType.STRING(160), allowNull: false })
  declare name: string;

  @Column({ field: 'version', type: DataType.INTEGER, allowNull: false })
  declare version: number;

  @Column({ field: 'body', type: DataType.TEXT, allowNull: false })
  declare body: string;

  /** `active` o `archived`. Archivada es la que rigió antes y sigue siendo prueba. */
  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  /**
   * El que rige salvo contrato negociado. Un índice único parcial garantiza que sólo haya uno
   * vigente por inquilino: con dos, «¿cuál manda?» lo decidiría el orden de la consulta.
   */
  @Column({ field: 'is_default', type: DataType.BOOLEAN, allowNull: false })
  declare isDefault: boolean;

  @Column({ field: 'effective_from', type: DataType.DATE, allowNull: false })
  declare effectiveFrom: Date;

  @Column({ field: 'created_by_internal_user_id', type: DataType.BIGINT })
  declare createdByInternalUserId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
