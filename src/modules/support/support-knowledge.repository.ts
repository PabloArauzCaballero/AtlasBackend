/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Busca y publica las respuestas que evitan abrir un caso, con su versión y su aprobador.
 * @system consulta `knowledge_article_versions` por `tsvector` en español, filtrando por audiencia.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { CreationAttributes, Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { KnowledgeArticleModel, KnowledgeArticleVersionModel } from '../../database/models/index.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const ARTICLES = `${atlasSchemaFor('knowledge_articles')}.knowledge_articles`;
const VERSIONS = `${atlasSchemaFor('knowledge_article_versions')}.knowledge_article_versions`;

export type RepositoryOptions = { transaction?: Transaction };

export interface KnowledgeSearchHit {
  readonly articleId: string;
  readonly articleKey: string;
  readonly versionId: string;
  readonly title: string;
  readonly question: string | null;
  readonly shortAnswer: string | null;
  readonly audience: string;
  readonly isFaq: boolean;
  readonly rank: number;
}

@Injectable()
export class SupportKnowledgeRepository {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(KnowledgeArticleModel) private readonly articles: typeof KnowledgeArticleModel,
    @InjectModel(KnowledgeArticleVersionModel) private readonly versions: typeof KnowledgeArticleVersionModel,
  ) {}

  /**
   * Búsqueda por relevancia, filtrada por audiencia EN EL SERVIDOR.
   *
   * El filtro de audiencia va dentro del `WHERE` y no en la capa de presentación porque el buscador
   * es el punto de fuga clásico: basta con que una pantalla olvide filtrar para que la guía interna
   * —que dice cómo se decide un crédito y cuándo escalar a fraude— aparezca en la app del cliente.
   *
   * Se busca sólo en la versión PUBLICADA de cada artículo: un borrador es texto que nadie aprobó, y
   * ofrecerlo como respuesta oficial es peor que no tener respuesta.
   */
  async search(input: {
    tenantId: string;
    query: string;
    audiences: readonly string[];
    limit: number;
  }): Promise<KnowledgeSearchHit[]> {
    const rows = await this.sequelize.query<{
      article_id: string;
      article_key: string;
      version_id: string;
      title: string;
      question: string | null;
      short_answer: string | null;
      audience: string;
      is_faq: boolean;
      rank: number;
    }>(
      `
      SELECT article._id      AS article_id,
             article.article_key,
             version._id      AS version_id,
             version.title,
             version.question,
             version.short_answer,
             article.audience,
             article.is_faq,
             ts_rank(version.search_vector, websearch_to_tsquery('spanish', :query)) AS rank
        FROM ${VERSIONS} AS version
        JOIN ${ARTICLES}  AS article
          ON article._id = version.article_id
         AND article.current_version_id = version._id
       WHERE article._tenant_id = :tenantId
         AND article._deleted = FALSE
         AND article.status = 'PUBLISHED'
         AND article.audience IN (:audiences)
         AND version.status = 'PUBLISHED'
         AND version.search_vector @@ websearch_to_tsquery('spanish', :query)
       ORDER BY rank DESC, article.display_order ASC
       LIMIT :limit;
      `,
      {
        replacements: { tenantId: input.tenantId, query: input.query, audiences: [...input.audiences], limit: input.limit },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      articleId: String(row.article_id),
      articleKey: row.article_key,
      versionId: String(row.version_id),
      title: row.title,
      question: row.question,
      shortAnswer: row.short_answer,
      audience: row.audience,
      isFaq: row.is_faq,
      rank: Number(row.rank),
    }));
  }

  /** Las FAQ destacadas de una audiencia: lo que se muestra sin que nadie haya buscado nada. */
  listFeaturedFaq(tenantId: string, audiences: readonly string[], limit = 20): Promise<KnowledgeArticleModel[]> {
    return this.articles.findAll({
      where: { tenantId, deleted: false, status: 'PUBLISHED', isFaq: true, audience: { [Op.in]: [...audiences] } },
      order: [
        ['is_featured', 'DESC'],
        ['display_order', 'ASC'],
      ],
      limit,
    });
  }

  findArticleByKey(tenantId: string, articleKey: string, options: RepositoryOptions = {}): Promise<KnowledgeArticleModel | null> {
    return this.articles.findOne({ where: { tenantId, articleKey, deleted: false }, transaction: options.transaction });
  }

  findArticleById(tenantId: string, articleId: string, options: RepositoryOptions = {}): Promise<KnowledgeArticleModel | null> {
    return this.articles.findOne({ where: { tenantId, id: articleId, deleted: false }, transaction: options.transaction });
  }

  async requireArticleById(tenantId: string, articleId: string, options: RepositoryOptions = {}): Promise<KnowledgeArticleModel> {
    const article = await this.findArticleById(tenantId, articleId, options);
    if (!article) throw new NotFoundException({ code: 'KNOWLEDGE_ARTICLE_NOT_FOUND', articleId });
    return article;
  }

  findVersionById(tenantId: string, versionId: string, options: RepositoryOptions = {}): Promise<KnowledgeArticleVersionModel | null> {
    return this.versions.findOne({ where: { tenantId, id: versionId }, transaction: options.transaction });
  }

  findPublishedVersion(articleId: string, locale: string): Promise<KnowledgeArticleVersionModel | null> {
    return this.versions.findOne({
      where: { articleId, locale, status: 'PUBLISHED' },
      order: [['version_number', 'DESC']],
    });
  }

  createArticle(values: CreationAttributes<KnowledgeArticleModel>, options: RepositoryOptions = {}): Promise<KnowledgeArticleModel> {
    return this.articles.create(values, { transaction: options.transaction });
  }

  async updateArticle(
    tenantId: string,
    articleId: string,
    values: Partial<KnowledgeArticleModel>,
    options: RepositoryOptions = {},
  ): Promise<void> {
    await this.articles.update({ ...values, updatedAtValue: new Date() } as Partial<KnowledgeArticleModel>, {
      where: { tenantId, id: articleId },
      transaction: options.transaction,
    });
  }

  async nextVersionNumber(articleId: string, locale: string, options: RepositoryOptions = {}): Promise<number> {
    const last = await this.versions.findOne({
      where: { articleId, locale },
      order: [['version_number', 'DESC']],
      transaction: options.transaction,
    });
    return (last?.versionNumber ?? 0) + 1;
  }

  createVersion(
    values: CreationAttributes<KnowledgeArticleVersionModel>,
    options: RepositoryOptions = {},
  ): Promise<KnowledgeArticleVersionModel> {
    return this.versions.create(values, { transaction: options.transaction });
  }

  async updateVersion(
    tenantId: string,
    versionId: string,
    values: Partial<KnowledgeArticleVersionModel>,
    options: RepositoryOptions = {},
  ): Promise<void> {
    await this.versions.update({ ...values, updatedAtValue: new Date() } as Partial<KnowledgeArticleVersionModel>, {
      where: { tenantId, id: versionId },
      transaction: options.transaction,
    });
  }

  /** Retira las versiones publicadas anteriores del mismo idioma al publicar una nueva. */
  async retirePublishedVersions(articleId: string, locale: string, exceptVersionId: string, options: RepositoryOptions = {}): Promise<void> {
    await this.versions.update(
      { status: 'RETIRED', retiredAt: new Date() },
      {
        where: { articleId, locale, status: 'PUBLISHED', id: { [Op.ne]: exceptVersionId } },
        transaction: options.transaction,
      },
    );
  }

  /**
   * Suma un voto de utilidad con `increment` y no leyendo-sumando-escribiendo.
   *
   * Dos personas votando a la vez sobre el mismo artículo perderían un voto con el patrón de
   * lectura previa; el incremento atómico de Postgres no.
   */
  async registerFeedback(tenantId: string, articleId: string, helpful: boolean): Promise<void> {
    await this.articles.increment(helpful ? 'helpfulCount' : 'notHelpfulCount', {
      by: 1,
      where: { tenantId, id: articleId, deleted: false },
    });
  }
}
