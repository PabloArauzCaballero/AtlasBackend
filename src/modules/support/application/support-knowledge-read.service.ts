/**
 * @file Caso de uso de lectura: lo que el personal necesita ver de la base de conocimiento.
 * @business Esta pieza deja que quien redacta, revisa o aprueba un artículo encuentre los borradores y las versiones en revisión sin que se las pasen por número.
 * @system lecturas paginadas de `knowledge_articles` y `knowledge_article_versions` para el personal (todas las audiencias, cualquier estado).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions } from 'sequelize';
import { KnowledgeArticleModel, KnowledgeArticleVersionModel } from '../../../database/models/index.js';
import type { ListKnowledgeArticlesQueryDto, ListKnowledgeVersionsQueryDto } from '../support-knowledge.schemas.js';

const articleView = (a: KnowledgeArticleModel) => ({
  articleId: String(a.id),
  articleKey: a.articleKey,
  audience: a.audience,
  status: a.status,
  ownerTeam: a.ownerTeam,
  currentVersionId: a.currentVersionId ? String(a.currentVersionId) : null,
  isFaq: a.isFaq,
  isFeatured: a.isFeatured,
  nextReviewAt: a.nextReviewAt,
  helpfulCount: a.helpfulCount,
  notHelpfulCount: a.notHelpfulCount,
  updatedAt: a.updatedAtValue,
});

const versionView = (v: KnowledgeArticleVersionModel) => ({
  versionId: String(v.id),
  articleId: String(v.articleId),
  versionNumber: v.versionNumber,
  locale: v.locale,
  status: v.status,
  title: v.title,
  question: v.question,
  shortAnswer: v.shortAnswer,
  createdByInternalUserId: v.createdByInternalUserId,
  reviewedByInternalUserId: v.reviewedByInternalUserId,
  approvedByInternalUserId: v.approvedByInternalUserId,
  approvedAt: v.approvedAt,
  publishedAt: v.publishedAt,
  retiredAt: v.retiredAt,
  changeReason: v.changeReason,
  updatedAt: v.updatedAtValue,
});

/**
 * Sin estas lecturas, el portal sólo podía ver lo PUBLICADO (por las rutas de la app) y quien aprueba
 * tenía que recibir el número de la versión de quien la redactó. Aquí no se filtra por audiencia: el
 * personal gobierna también las guías internas, y la ruta ya exige un rol interno.
 */
@Injectable()
export class SupportKnowledgeReadService {
  constructor(
    @InjectModel(KnowledgeArticleModel) private readonly articles: typeof KnowledgeArticleModel,
    @InjectModel(KnowledgeArticleVersionModel) private readonly versions: typeof KnowledgeArticleVersionModel,
  ) {}

  async listArticles(tenantId: string, query: ListKnowledgeArticlesQueryDto) {
    const where: WhereOptions = { tenantId, deleted: false };
    if (query.status) Object.assign(where, { status: query.status });
    if (query.audience) Object.assign(where, { audience: query.audience });
    if (query.search) Object.assign(where, { articleKey: { [Op.iLike]: `%${query.search}%` } });
    const { rows, count } = await this.articles.findAndCountAll({
      where,
      order: [['_updated_at', 'DESC NULLS LAST']],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items: rows.map(articleView), total: count, page: query.page, pageSize: query.pageSize };
  }

  async getArticle(tenantId: string, articleId: string) {
    const article = await this.articles.findOne({ where: { tenantId, id: articleId, deleted: false } });
    if (!article) throw new NotFoundException({ code: 'KNOWLEDGE_ARTICLE_NOT_FOUND', articleId });
    const versions = await this.versions.findAll({ where: { tenantId, articleId }, order: [['version_number', 'DESC']] });
    return { ...articleView(article), versions: versions.map(versionView) };
  }

  /** La cola de trabajo de la base de conocimiento: versiones por estado (p. ej. las que esperan aprobación). */
  async listVersions(tenantId: string, query: ListKnowledgeVersionsQueryDto) {
    const where: WhereOptions = { tenantId };
    if (query.status) Object.assign(where, { status: query.status });
    if (query.articleId) Object.assign(where, { articleId: query.articleId });
    const { rows, count } = await this.versions.findAndCountAll({
      where,
      order: [['_updated_at', 'DESC NULLS LAST']],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items: rows.map(versionView), total: count, page: query.page, pageSize: query.pageSize };
  }

  async getVersion(tenantId: string, versionId: string) {
    const version = await this.versions.findOne({ where: { tenantId, id: versionId } });
    if (!version) throw new NotFoundException({ code: 'KNOWLEDGE_VERSION_NOT_FOUND', versionId });
    return { ...versionView(version), bodyMarkdown: version.bodyMarkdown, tags: version.tagsJson, escalateWhen: version.escalateWhen };
  }
}
