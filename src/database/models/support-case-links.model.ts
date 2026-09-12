/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Cómo se relacionan dos casos: duplicado, causado por, seguimiento o incidente mayor.
 * @system `support.support_case_links`, la relación explícita entre expedientes.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Agrupar no es cerrar.
 *
 * Cuando cien casos comparten causa se enlazan al incidente mayor, y cada uno conserva su
 * expediente, su SLA y su respuesta. Cerrarlos "porque ya se agruparon" deja a cien personas sin
 * saber qué pasó con lo suyo.
 */
@Table({ tableName: 'support_case_links', schema: atlasSchemaFor('support_case_links'), timestamps: false })
export class SupportCaseLinkModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'case_id', type: DataType.BIGINT, allowNull: false })
  declare caseId: string;

  @Column({ field: 'linked_case_id', type: DataType.BIGINT, allowNull: false })
  declare linkedCaseId: string;

  @Column({ field: 'link_type', type: DataType.STRING(40), allowNull: false })
  declare linkType: string;

  @Column({ field: 'note', type: DataType.STRING(400) })
  declare note: string | null;

  @Column({ field: 'created_by_actor_id', type: DataType.STRING(64) })
  declare createdByActorId: string | null;
}
