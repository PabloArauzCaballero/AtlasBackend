/**
 * @file Adaptador HTTP: administración de la base de conocimiento.
 * @business Redactar, revisar, aprobar y publicar las respuestas oficiales de Atlas.
 * @system flujo DRAFT → IN_REVIEW → APPROVED → PUBLISHED; publicado no se edita, se versiona.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { SupportActorService } from './application/support-actor.service.js';
import { SupportKnowledgeReadService } from './application/support-knowledge-read.service.js';
import { SupportKnowledgeService } from './application/support-knowledge.service.js';
import {
  type CreateArticleDto,
  createArticleSchema,
  knowledgeIdParamSchema,
  type ListKnowledgeArticlesQueryDto,
  listKnowledgeArticlesQuerySchema,
  type ListKnowledgeVersionsQueryDto,
  listKnowledgeVersionsQuerySchema,
  type CreateArticleVersionDto,
  createArticleVersionSchema,
  type PublishVersionDto,
  publishVersionSchema,
  type ReviewDecisionDto,
  reviewDecisionSchema,
} from './support-knowledge.schemas.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';

/**
 * El gobierno del contenido de ayuda.
 *
 * No hay endpoint para editar un artículo publicado: la única forma de cambiar lo que dice es
 * publicar otra versión, que vuelve a pasar por revisión y aprobación. Es lo que permite responder
 * «qué decía el 3 de marzo» cuando alguien reclama haber seguido una instrucción.
 */
@ApiTags('Admin · Conocimiento de soporte')
@ApiBearerAuth('access-token')
@Controller('admin/support/knowledge')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'compliance_analyst', 'risk_analyst', 'admin', 'platform_admin')
export class SupportKnowledgeAdminController {
  constructor(
    private readonly actors: SupportActorService,
    private readonly knowledge: SupportKnowledgeService,
    private readonly reads: SupportKnowledgeReadService,
  ) {}

  @ApiOperation({ summary: 'Artículos para el personal: cualquier estado y audiencia, paginados' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Artículos con su estado y su versión vigente.' })
  @Get('articles')
  listArticles(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(listKnowledgeArticlesQuerySchema)) query: ListKnowledgeArticlesQueryDto,
  ) {
    return this.reads.listArticles(tenantId, query);
  }

  @ApiOperation({ summary: 'Un artículo con todas sus versiones' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 404, description: 'KNOWLEDGE_ARTICLE_NOT_FOUND.' })
  @ApiResponse({ status: 200, description: 'Artículo y versiones, de la más nueva a la más vieja.' })
  @Get('articles/:articleId')
  getArticle(@CurrentTenant() tenantId: string, @Param('articleId', new ZodValidationPipe(knowledgeIdParamSchema)) articleId: string) {
    return this.reads.getArticle(tenantId, articleId);
  }

  @ApiOperation({ summary: 'Versiones por estado: la cola de revisión y publicación de la base de conocimiento' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Versiones paginadas.' })
  @Get('versions')
  listVersions(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(listKnowledgeVersionsQuerySchema)) query: ListKnowledgeVersionsQueryDto,
  ) {
    return this.reads.listVersions(tenantId, query);
  }

  @ApiOperation({ summary: 'Una versión con su texto completo, para revisarla antes de aprobar' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 404, description: 'KNOWLEDGE_VERSION_NOT_FOUND.' })
  @ApiResponse({ status: 200, description: 'Versión con cuerpo, etiquetas y regla de escalado.' })
  @Get('versions/:versionId')
  getVersion(@CurrentTenant() tenantId: string, @Param('versionId', new ZodValidationPipe(knowledgeIdParamSchema)) versionId: string) {
    return this.reads.getVersion(tenantId, versionId);
  }

  @ApiOperation({ summary: 'Crear un artículo (identidad y gobierno; el texto va en su versión)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 409, description: 'KNOWLEDGE_ARTICLE_KEY_TAKEN.' })
  @ApiResponse({ status: 201, description: 'Artículo creado, todavía sin versión publicada.' })
  @Post('articles')
  async createArticle(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createArticleSchema)) body: CreateArticleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.createArticle({ tenantId, actor, dto: body });
  }

  @ApiOperation({ summary: 'Crear una versión nueva del artículo' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('articles/:articleId/versions')
  async createVersion(
    @CurrentTenant() tenantId: string,
    @Param('articleId') articleId: string,
    @Body(new ZodValidationPipe(createArticleVersionSchema)) body: CreateArticleVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.createVersion({ tenantId, actor, articleId, dto: body });
  }

  @ApiOperation({ summary: 'Enviar la versión a revisión' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('versions/:versionId/submit-review')
  @HttpCode(HttpStatus.OK)
  async submitReview(
    @CurrentTenant() tenantId: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.submitForReview({ tenantId, actor, versionId, dto: body });
  }

  @ApiOperation({ summary: 'Aprobar la versión (quien la redactó no puede aprobarla)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 403, description: 'KNOWLEDGE_SELF_APPROVAL_FORBIDDEN o KNOWLEDGE_DOMAIN_APPROVER_REQUIRED.' })
  @ApiResponse({ status: 200, description: 'Versión aprobada y lista para publicar.' })
  @Post('versions/:versionId/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentTenant() tenantId: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.approve({ tenantId, actor, versionId, dto: body });
  }

  @ApiOperation({ summary: 'Publicar la versión aprobada' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 409, description: 'KNOWLEDGE_VERSION_NOT_APPROVED.' })
  @ApiResponse({ status: 200, description: 'Versión publicada; pasa a ser la vigente del artículo.' })
  @Post('versions/:versionId/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentTenant() tenantId: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(publishVersionSchema)) body: PublishVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.publish({ tenantId, actor, versionId, dto: body });
  }
}
