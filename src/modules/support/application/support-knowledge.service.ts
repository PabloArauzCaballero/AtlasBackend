/**
 * @file Servicio de aplicación: buscar, versionar y publicar la base de conocimiento.
 * @business Las respuestas que evitan abrir un caso, y el control de quién las aprueba.
 * @system búsqueda filtrada por audiencia y flujo DRAFT → IN_REVIEW → APPROVED → PUBLISHED.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportKnowledgeRepository } from '../support-knowledge.repository.js';
import type {
  CreateArticleDto,
  CreateArticleVersionDto,
  KnowledgeFeedbackDto,
  KnowledgeSearchDto,
  PublishVersionDto,
  ReviewDecisionDto,
} from '../support-knowledge.schemas.js';
import { toKnowledgeVersionDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';

/**
 * Equipos cuyo contenido no puede aprobar un editor de contenido cualquiera.
 *
 * Un artículo sobre cómo se decide un crédito, qué hacer ante un fraude o qué datos guardamos es
 * una declaración con consecuencias legales. Que lo redacte quien sepa escribir está bien; que lo
 * apruebe sin pasar por el dominio dueño, no.
 */
const DOMAIN_APPROVAL_TEAMS = ['credit', 'risk', 'security', 'legal', 'kyc', 'privacy', 'payments'];
const DOMAIN_APPROVER_ROLES = ['compliance_analyst', 'risk_analyst', 'admin', 'platform_admin'];

@Injectable()
export class SupportKnowledgeService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly knowledge: SupportKnowledgeRepository,
    private readonly catalog: SupportCatalogRepository,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
  ) {}

  /** Buscar. La audiencia la deriva el servidor del actor; nunca llega en la petición. */
  async search(input: { tenantId: string; actor: SupportActor; dto: KnowledgeSearchDto }) {
    const hits = await this.knowledge.search({
      tenantId: input.tenantId,
      query: input.dto.q,
      audiences: this.actors.knowledgeAudiences(input.actor),
      limit: input.dto.limit,
    });
    return { query: input.dto.q, results: hits };
  }

  /** Lo que se muestra sin que nadie haya buscado nada: las preguntas frecuentes destacadas. */
  async featuredFaq(input: { tenantId: string; actor: SupportActor }) {
    const articles = await this.knowledge.listFeaturedFaq(input.tenantId, this.actors.knowledgeAudiences(input.actor));
    const versions = await Promise.all(
      articles.map(async (article) => {
        const version = article.currentVersionId
          ? await this.knowledge.findVersionById(input.tenantId, String(article.currentVersionId))
          : null;
        return version ? toKnowledgeVersionDto(version, article.articleKey) : null;
      }),
    );
    return { faq: versions.filter((version): version is NonNullable<typeof version> => version !== null) };
  }

  /** Un artículo por su clave, en la versión publicada que corresponde a la audiencia del actor. */
  async getByKey(input: { tenantId: string; actor: SupportActor; articleKey: string; locale?: string }) {
    const article = await this.knowledge.findArticleByKey(input.tenantId, input.articleKey);
    if (!article || article.status !== 'PUBLISHED') {
      throw new NotFoundException({ code: 'KNOWLEDGE_ARTICLE_NOT_FOUND', articleKey: input.articleKey });
    }
    if (!this.actors.knowledgeAudiences(input.actor).includes(article.audience)) {
      throw new ForbiddenException({ code: 'KNOWLEDGE_ARTICLE_FORBIDDEN' });
    }

    const version = await this.knowledge.findPublishedVersion(String(article.id), input.locale ?? 'es-BO');
    if (!version) throw new NotFoundException({ code: 'KNOWLEDGE_VERSION_NOT_FOUND', articleKey: input.articleKey });
    return toKnowledgeVersionDto(version, article.articleKey);
  }

  /**
   * El voto de utilidad, con la búsqueda que llevó hasta el artículo.
   *
   * Guardar la consulta original es lo que revela el vocabulario que falta: la gente escribe «no me
   * llega el codigo» y el artículo dice «no recibo el OTP». Sin ese dato, un artículo puede estar
   * bien escrito y no encontrarse nunca, y nadie sabría por qué.
   */
  async submitFeedback(input: { tenantId: string; actor: SupportActor; articleId: string; dto: KnowledgeFeedbackDto }) {
    await this.knowledge.requireArticleById(input.tenantId, input.articleId);
    await this.knowledge.registerFeedback(input.tenantId, input.articleId, input.dto.helpful);
    await this.audit.record({
      tenantId: input.tenantId,
      actor: input.actor,
      actionCode: 'support.knowledge.feedback',
      targetType: 'knowledge_article',
      targetId: input.articleId,
      payload: { helpful: input.dto.helpful, searchQuery: input.dto.searchQuery ?? null, avoidedCase: input.dto.avoidedCase ?? null },
    });
    return { articleId: input.articleId, recorded: true };
  }

  /** Crear el artículo: su identidad y su gobierno. El texto llega con la primera versión. */
  async createArticle(input: { tenantId: string; actor: SupportActor; dto: CreateArticleDto }) {
    this.assertEditor(input.actor);
    const existing = await this.knowledge.findArticleByKey(input.tenantId, input.dto.articleKey);
    if (existing) throw new ConflictException({ code: 'KNOWLEDGE_ARTICLE_KEY_TAKEN', articleKey: input.dto.articleKey });

    const category = input.dto.categoryCode ? await this.catalog.findCategoryByCode(input.tenantId, input.dto.categoryCode) : null;
    const article = await this.knowledge.createArticle({
      tenantId: input.tenantId,
      articleKey: input.dto.articleKey,
      audience: input.dto.audience,
      categoryId: category ? String(category.id) : null,
      status: 'DRAFT',
      ownerTeam: input.dto.ownerTeam,
      isFaq: input.dto.isFaq,
      isFeatured: input.dto.isFeatured,
      productScope: input.dto.productScope ?? null,
      reviewCycleDays: input.dto.reviewCycleDays,
      nextReviewAt: new Date(Date.now() + input.dto.reviewCycleDays * 86_400_000),
      helpfulCount: 0,
      notHelpfulCount: 0,
      displayOrder: 100,
      deleted: false,
    });

    return { articleId: String(article.id), articleKey: article.articleKey, status: article.status };
  }

  /** Una versión nueva nace en DRAFT. Publicado no se edita: se publica otra versión. */
  async createVersion(input: { tenantId: string; actor: SupportActor; articleId: string; dto: CreateArticleVersionDto }) {
    this.assertEditor(input.actor);
    const article = await this.knowledge.requireArticleById(input.tenantId, input.articleId);
    const versionNumber = await this.knowledge.nextVersionNumber(input.articleId, input.dto.locale);

    const version = await this.knowledge.createVersion({
      tenantId: input.tenantId,
      articleId: input.articleId,
      versionNumber,
      locale: input.dto.locale,
      status: 'DRAFT',
      title: input.dto.title,
      question: input.dto.question ?? null,
      shortAnswer: input.dto.shortAnswer ?? null,
      bodyMarkdown: input.dto.bodyMarkdown,
      tagsJson: input.dto.tags,
      canonicalQueryTermsJson: input.dto.canonicalQueryTerms,
      escalateWhen: input.dto.escalateWhen,
      createdByInternalUserId: input.actor.actorId,
      changeReason: input.dto.changeReason,
      checksum: sha256Hex(`${input.dto.title}${input.dto.bodyMarkdown}`),
    });

    return toKnowledgeVersionDto(version, article.articleKey);
  }

  async submitForReview(input: { tenantId: string; actor: SupportActor; versionId: string; dto: ReviewDecisionDto }) {
    this.assertEditor(input.actor);
    const version = await this.requireVersion(input.tenantId, input.versionId);
    if (version.status !== 'DRAFT') throw new ConflictException({ code: 'KNOWLEDGE_VERSION_NOT_DRAFT', status: version.status });

    await this.knowledge.updateVersion(input.tenantId, input.versionId, { status: 'IN_REVIEW' });
    await this.knowledge.updateArticle(input.tenantId, String(version.articleId), { status: 'IN_REVIEW' });
    return { versionId: input.versionId, status: 'IN_REVIEW', note: input.dto.note ?? null };
  }

  /**
   * Aprobar, con dos controles que no se pueden saltar.
   *
   * **Segregación de funciones:** quien escribió no aprueba. Sin esto, «aprobado» significa
   * solamente que el autor volvió a pulsar un botón.
   *
   * **Aprobador del dominio:** un artículo de crédito, seguridad, legal, KYC, privacidad o pagos
   * exige un rol de riesgo o cumplimiento. Un editor de contenido no puede cambiar unilateralmente
   * una política publicada por más impecable que sea su redacción.
   */
  async approve(input: { tenantId: string; actor: SupportActor; versionId: string; dto: ReviewDecisionDto }) {
    this.assertEditor(input.actor);
    const version = await this.requireVersion(input.tenantId, input.versionId);
    if (version.status !== 'IN_REVIEW') throw new ConflictException({ code: 'KNOWLEDGE_VERSION_NOT_IN_REVIEW', status: version.status });
    if (version.createdByInternalUserId && String(version.createdByInternalUserId) === input.actor.actorId) {
      throw new ForbiddenException({ code: 'KNOWLEDGE_SELF_APPROVAL_FORBIDDEN', message: 'Quien redactó una versión no puede aprobarla.' });
    }

    const article = await this.knowledge.requireArticleById(input.tenantId, String(version.articleId));
    if (DOMAIN_APPROVAL_TEAMS.includes(article.ownerTeam) && !DOMAIN_APPROVER_ROLES.includes(input.actor.role)) {
      throw new ForbiddenException({
        code: 'KNOWLEDGE_DOMAIN_APPROVER_REQUIRED',
        message: `Un artículo de ${article.ownerTeam} lo aprueba el dominio responsable, no el equipo de contenido.`,
        ownerTeam: article.ownerTeam,
      });
    }

    await this.knowledge.updateVersion(input.tenantId, input.versionId, {
      status: 'APPROVED',
      approvedByInternalUserId: input.actor.actorId,
      approvedAt: new Date(),
      reviewedByInternalUserId: input.actor.actorId,
    });
    await this.knowledge.updateArticle(input.tenantId, String(version.articleId), { status: 'APPROVED' });
    await this.audit.record({
      tenantId: input.tenantId,
      actor: input.actor,
      actionCode: 'support.knowledge.approve',
      targetType: 'knowledge_article_version',
      targetId: input.versionId,
      payload: { articleKey: article.articleKey, ownerTeam: article.ownerTeam },
    });

    return { versionId: input.versionId, status: 'APPROVED' };
  }

  /** Publicar: la versión aprobada pasa a ser la actual y la anterior del mismo idioma se retira. */
  async publish(input: { tenantId: string; actor: SupportActor; versionId: string; dto: PublishVersionDto }) {
    this.assertEditor(input.actor);
    const version = await this.requireVersion(input.tenantId, input.versionId);
    if (version.status !== 'APPROVED') throw new ConflictException({ code: 'KNOWLEDGE_VERSION_NOT_APPROVED', status: version.status });

    const article = await this.knowledge.requireArticleById(input.tenantId, String(version.articleId));
    await this.sequelize.transaction(async (transaction) => {
      if (input.dto.retirePrevious) {
        await this.knowledge.retirePublishedVersions(String(version.articleId), version.locale, input.versionId, { transaction });
      }
      await this.knowledge.updateVersion(input.tenantId, input.versionId, { status: 'PUBLISHED', publishedAt: new Date() }, { transaction });
      await this.knowledge.updateArticle(
        input.tenantId,
        String(version.articleId),
        { status: 'PUBLISHED', currentVersionId: input.versionId },
        { transaction },
      );
    });

    await this.audit.publish({
      tenantId: input.tenantId,
      eventCode: 'support.knowledge.published',
      aggregateType: 'knowledge_article',
      aggregateId: String(version.articleId),
      payload: { articleKey: article.articleKey, versionId: input.versionId, versionNumber: version.versionNumber },
      idempotencyKey: `knowledge-published-${input.versionId}`,
    });

    return { articleId: String(version.articleId), versionId: input.versionId, status: 'PUBLISHED' };
  }

  private async requireVersion(tenantId: string, versionId: string) {
    const version = await this.knowledge.findVersionById(tenantId, versionId);
    if (!version) throw new NotFoundException({ code: 'KNOWLEDGE_VERSION_NOT_FOUND', versionId });
    return version;
  }

  private assertEditor(actor: SupportActor): void {
    if (!actor.isInternal) throw new ForbiddenException({ code: 'KNOWLEDGE_EDITOR_REQUIRED' });
  }
}
