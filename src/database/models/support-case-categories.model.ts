/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business La taxonomía jerárquica del soporte: motivo y submotivo de por qué alguien pidió ayuda.
 * @system `support.support_case_categories`, árbol versionado que enruta, prioriza y clasifica.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * `PAYMENT > PAYMENT_PROOF > NOT_RECOGNIZED` se puede contar; «no me reconocen el pago» no.
 *
 * La categoría trae consigo la cola por defecto, la sensibilidad y el impacto esperado, así que
 * clasificar es también enrutar y proteger: un caso de fraude nace restringido aunque todavía nadie
 * haya escrito una línea en él.
 */
@Table({ tableName: 'support_case_categories', schema: atlasSchemaFor('support_case_categories'), timestamps: false })
export class SupportCaseCategoryModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'category_code', type: DataType.STRING(80), allowNull: false })
  declare categoryCode: string;

  @Column({ field: 'parent_category_id', type: DataType.BIGINT })
  declare parentCategoryId: string | null;

  @Column({ field: 'domain', type: DataType.STRING(30), allowNull: false })
  declare domain: string;

  @Column({ field: 'default_case_type', type: DataType.STRING(40) })
  declare defaultCaseType: string | null;

  @Column({ field: 'label', type: DataType.STRING(160), allowNull: false })
  declare label: string;

  @Column({ field: 'description', type: DataType.STRING(400) })
  declare description: string | null;

  @Column({ field: 'audience', type: DataType.STRING(30), allowNull: false })
  declare audience: string;

  @Column({ field: 'sensitivity', type: DataType.STRING(20), allowNull: false })
  declare sensitivity: string;

  @Column({ field: 'default_queue_id', type: DataType.BIGINT })
  declare defaultQueueId: string | null;

  @Column({ field: 'default_impact', type: DataType.STRING(20), allowNull: false })
  declare defaultImpact: string;

  @Column({ field: 'default_urgency', type: DataType.STRING(20), allowNull: false })
  declare defaultUrgency: string;

  @Column({ field: 'requires_specialist', type: DataType.BOOLEAN, allowNull: false })
  declare requiresSpecialist: boolean;

  @Column({ field: 'catalog_version', type: DataType.INTEGER, allowNull: false })
  declare catalogVersion: number;

  @Column({ field: 'display_order', type: DataType.INTEGER, allowNull: false })
  declare displayOrder: number;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
