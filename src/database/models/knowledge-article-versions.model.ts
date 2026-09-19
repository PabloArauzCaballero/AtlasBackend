/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business El texto concreto de un artículo de ayuda, con quién lo aprobó y cuándo se publicó.
 * @system `support.knowledge_article_versions`, con `search_vector` en español para la búsqueda.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Lo que se aprueba es un TEXTO, no un título.
 *
 * Por eso la aprobación vive en la versión: si estuviera en el artículo, cambiar el contenido no
 * volvería a pedirla y cualquiera podría reescribir en caliente una política de crédito publicada.
 * `checksum` permite verificar después que la versión publicada es la que se aprobó.
 */
@Table({ tableName: 'knowledge_article_versions', schema: atlasSchemaFor('knowledge_article_versions'), timestamps: false })
export class KnowledgeArticleVersionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'article_id', type: DataType.BIGINT, allowNull: false })
  declare articleId: string;

  @Column({ field: 'version_number', type: DataType.INTEGER, allowNull: false })
  declare versionNumber: number;

  @Column({ field: 'locale', type: DataType.STRING(10), allowNull: false })
  declare locale: string;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'title', type: DataType.STRING(200), allowNull: false })
  declare title: string;

  @Column({ field: 'question', type: DataType.STRING(300) })
  declare question: string | null;

  @Column({ field: 'short_answer', type: DataType.STRING(600) })
  declare shortAnswer: string | null;

  @Column({ field: 'body_markdown', type: DataType.TEXT, allowNull: false })
  declare bodyMarkdown: string;

  @Column({ field: 'tags_json', type: DataType.JSONB, allowNull: false })
  declare tagsJson: string[];

  @Column({ field: 'canonical_query_terms_json', type: DataType.JSONB, allowNull: false })
  declare canonicalQueryTermsJson: string[];

  /** Cuándo dejar de intentarlo solo y escalar. Es lo que distingue una guía de un folleto. */
  @Column({ field: 'escalate_when', type: DataType.TEXT })
  declare escalateWhen: string | null;

  @Column({ field: 'created_by_internal_user_id', type: DataType.BIGINT })
  declare createdByInternalUserId: string | null;

  @Column({ field: 'reviewed_by_internal_user_id', type: DataType.BIGINT })
  declare reviewedByInternalUserId: string | null;

  @Column({ field: 'approved_by_internal_user_id', type: DataType.BIGINT })
  declare approvedByInternalUserId: string | null;

  @Column({ field: 'approved_at', type: DataType.DATE })
  declare approvedAt: Date | null;

  @Column({ field: 'published_at', type: DataType.DATE })
  declare publishedAt: Date | null;

  @Column({ field: 'retired_at', type: DataType.DATE })
  declare retiredAt: Date | null;

  @Column({ field: 'change_reason', type: DataType.STRING(400) })
  declare changeReason: string | null;

  @Column({ field: 'checksum', type: DataType.CHAR(64), allowNull: false })
  declare checksum: string;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
