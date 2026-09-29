/**
 * @file Caso de uso de lectura: lo que el personal necesita ver de la base de conocimiento.
 * @business Esta pieza deja que quien redacta, revisa o aprueba un artículo encuentre los borradores y las versiones en revisión sin que se las pasen por número.
 * @system lecturas paginadas de `knowledge_articles` y `knowledge_article_versions` para el personal (todas las audiencias, cualquier estado).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions, literal } from 'sequelize';
import { KnowledgeArticleModel, KnowledgeArticleVersionModel } from '../../../database/models/index.js';
import { containsLikePattern } from '../../../common/utils/strings/like-pattern.util.js';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
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
const KNOWLEDGE_VERSIONS = `${atlasSchemaFor('knowledge_article_versions')}.knowledge_article_versions`;

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
    /*
     * La clave o el TÍTULO de la versión vigente. Antes sólo la clave, y sin escapar comodines: quien
     * buscaba «código» por lo que dice el artículo no lo encontraba si la clave era «otp-no-llega».
     */
    const replacements = query.search ? { tenantBusqueda: tenantId, patronBusqueda: containsLikePattern(query.search) } : undefined;
    if (replacements) {
      const titled = literal(
        `(SELECT v._id FROM ${KNOWLEDGE_VERSIONS} v WHERE v._tenant_id = :tenantBusqueda AND v.title ILIKE :patronBusqueda)`,
      );
      const byKeyOrTitle = [{ articleKey: { [Op.iLike]: replacements.patronBusqueda } }, { currentVersionId: { [Op.in]: titled } }];
      Object.assign(where, { [Op.or]: byKeyOrTitle });
    }
    const { rows, count } = await this.articles.findAndCountAll({
      where,
      replacements,
      order: [['_updated_at', 'DESC NULLS LAST']],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const titles = await this.currentTitles(tenantId, rows);
    const items = rows.map((row) => ({ ...articleView(row), currentTitle: titles.get(String(row.currentVersionId)) ?? null }));
    return { items, total: count, page: query.page, pageSize: query.pageSize };
  }

  /** El título de la versión vigente de cada artículo de la página, en una sola consulta. */
  private async currentTitles(tenantId: string, rows: KnowledgeArticleModel[]): Promise<Map<string, string>> {
    const ids = rows.map((row) => row.currentVersionId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return new Map();
    const versions = await this.versions.findAll({ where: { tenantId, id: { [Op.in]: ids } }, attributes: ['id', 'title'] });
    return new Map(versions.map((version) => [String(version.id), version.title]));
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
