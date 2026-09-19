/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business El artículo de ayuda como identidad estable: el enlace que se comparte y se mantiene.
 * @system `support.knowledge_articles`; el contenido vive en `knowledge_article_versions`.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El artículo es el enlace; la versión es el texto.
 *
 * Separarlos permite compartir una dirección que no cambia y, aun así, poder demostrar qué decía el
 * día que alguien la leyó. `audience` no es una convención sino una columna, porque basta olvidar el
 * filtro una vez —en el buscador— para publicar la guía interna a los clientes.
 */
@Table({ tableName: 'knowledge_articles', schema: atlasSchemaFor('knowledge_articles'), timestamps: false })
export class KnowledgeArticleModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'article_key', type: DataType.STRING(120), allowNull: false })
  declare articleKey: string;

  @Column({ field: 'audience', type: DataType.STRING(30), allowNull: false })
  declare audience: string;

  @Column({ field: 'category_id', type: DataType.BIGINT })
  declare categoryId: string | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'current_version_id', type: DataType.BIGINT })
  declare currentVersionId: string | null;

  @Column({ field: 'owner_team', type: DataType.STRING(80), allowNull: false })
  declare ownerTeam: string;

  @Column({ field: 'is_faq', type: DataType.BOOLEAN, allowNull: false })
  declare isFaq: boolean;

  @Column({ field: 'is_featured', type: DataType.BOOLEAN, allowNull: false })
  declare isFeatured: boolean;

  @Column({ field: 'product_scope', type: DataType.STRING(60) })
  declare productScope: string | null;

  @Column({ field: 'review_cycle_days', type: DataType.INTEGER, allowNull: false })
  declare reviewCycleDays: number;

  @Column({ field: 'next_review_at', type: DataType.DATE })
  declare nextReviewAt: Date | null;

  @Column({ field: 'helpful_count', type: DataType.INTEGER, allowNull: false })
  declare helpfulCount: number;

  @Column({ field: 'not_helpful_count', type: DataType.INTEGER, allowNull: false })
  declare notHelpfulCount: number;

  @Column({ field: 'display_order', type: DataType.INTEGER, allowNull: false })
  declare displayOrder: number;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
