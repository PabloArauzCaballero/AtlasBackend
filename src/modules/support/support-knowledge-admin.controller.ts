/**
 * @file Adaptador HTTP: administración de la base de conocimiento.
 * @business Redactar, revisar, aprobar y publicar las respuestas oficiales de Atlas.
 * @system flujo DRAFT → IN_REVIEW → APPROVED → PUBLISHED; publicado no se edita, se versiona.
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { SupportActorService } from './application/support-actor.service.js';
import { SupportKnowledgeService } from './application/support-knowledge.service.js';
import {
  type CreateArticleDto,
  createArticleSchema,
  type CreateArticleVersionDto,
  createArticleVersionSchema,
  type PublishVersionDto,
  publishVersionSchema,
  type ReviewDecisionDto,
  reviewDecisionSchema,
} from './support-knowledge.schemas.js';

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
  ) {}

  @ApiOperation({ summary: 'Crear un artículo (identidad y gobierno; el texto va en su versión)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 409, description: 'KNOWLEDGE_ARTICLE_KEY_TAKEN.' })
  @Post('articles')
  async createArticle(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(createArticleSchema)) body: CreateArticleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.createArticle({ tenantId, actor, dto: body });
  }

  @ApiOperation({ summary: 'Crear una versión nueva del artículo' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('articles/:articleId/versions')
  async createVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('articleId') articleId: string,
    @Body(new ZodValidationPipe(createArticleVersionSchema)) body: CreateArticleVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.createVersion({ tenantId, actor, articleId, dto: body });
  }

  @ApiOperation({ summary: 'Enviar la versión a revisión' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('versions/:versionId/submit-review')
  @HttpCode(HttpStatus.OK)
  async submitReview(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.submitForReview({ tenantId, actor, versionId, dto: body });
  }

  @ApiOperation({ summary: 'Aprobar la versión (quien la redactó no puede aprobarla)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 403, description: 'KNOWLEDGE_SELF_APPROVAL_FORBIDDEN o KNOWLEDGE_DOMAIN_APPROVER_REQUIRED.' })
  @Post('versions/:versionId/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.approve({ tenantId, actor, versionId, dto: body });
  }

  @ApiOperation({ summary: 'Publicar la versión aprobada' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 409, description: 'KNOWLEDGE_VERSION_NOT_APPROVED.' })
  @Post('versions/:versionId/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(publishVersionSchema)) body: PublishVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.publish({ tenantId, actor, versionId, dto: body });
  }
}
