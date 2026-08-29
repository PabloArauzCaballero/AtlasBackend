/**
 * @file Adaptador HTTP: el centro de ayuda y los casos del cliente, desde la app.
 * @business Buscar una respuesta antes de molestar a nadie y, si no alcanza, abrir un caso con estado.
 * @system valida con Zod, resuelve el actor desde el token y delega; sin lógica de negocio aquí.
 */
import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { SupportCaseReadService } from './application/support-case-read.service.js';
import { SupportCaseClosureService } from './application/support-case-closure.service.js';
import { SupportCaseCustomerService } from './application/support-case-customer.service.js';
import { SupportCaseService } from './application/support-case.service.js';
import { SupportKnowledgeService } from './application/support-knowledge.service.js';
import {
  type CaseFeedbackDto,
  caseFeedbackSchema,
  type CloseCaseDto,
  closeCaseSchema,
  type ListCasesQueryDto,
  listCasesQuerySchema,
  type OpenCaseDto,
  openCaseSchema,
  type ReopenCaseDto,
  reopenCaseSchema,
} from './support-case.schemas.js';
import { type KnowledgeFeedbackDto, knowledgeFeedbackSchema, type KnowledgeSearchDto, knowledgeSearchSchema } from './support-knowledge.schemas.js';

/**
 * El centro de ayuda del cliente.
 *
 * El orden de los endpoints refleja el del producto: primero buscar, después preguntar. Una base de
 * conocimiento que se ofrece DESPUÉS de abrir el caso no deflecta nada.
 */
@ApiTags('Mobile · Soporte')
@ApiBearerAuth('access-token')
@Controller('mobile/support')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'admin', 'platform_admin')
export class MobileSupportController {
  constructor(
    private readonly actors: SupportActorService,
    private readonly cases: SupportCaseService,
    private readonly read: SupportCaseReadService,
    private readonly closure: SupportCaseClosureService,
    private readonly customerActions: SupportCaseCustomerService,
    private readonly knowledge: SupportKnowledgeService,
  ) {}

  @ApiOperation({ summary: 'Preguntas frecuentes destacadas' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'FAQ publicadas para la audiencia del solicitante.' })
  @Get('faq')
  async faq(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.featuredFaq({ tenantId, actor });
  }

  @ApiOperation({ summary: 'Buscar en la ayuda' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Artículos publicados ordenados por relevancia.' })
  @Get('knowledge/search')
  async search(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(knowledgeSearchSchema)) query: KnowledgeSearchDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.search({ tenantId, actor, dto: query });
  }

  @ApiOperation({ summary: 'Leer un artículo de ayuda' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('knowledge/articles/:articleKey')
  async article(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('articleKey') articleKey: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.getByKey({ tenantId, actor, articleKey });
  }

  @ApiOperation({ summary: '¿Te sirvió este artículo?' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('knowledge/articles/:articleId/feedback')
  async articleFeedback(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('articleId') articleId: string,
    @Body(new ZodValidationPipe(knowledgeFeedbackSchema)) body: KnowledgeFeedbackDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.submitFeedback({ tenantId, actor, articleId, dto: body });
  }

  @ApiOperation({ summary: 'Abrir un caso de soporte' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 201, description: 'Caso creado, con su canal de conversación.' })
  @ApiResponse({ status: 409, description: 'SUPPORT_CASE_POSSIBLE_DUPLICATE: ya hay un caso abierto igual.' })
  @Post('cases')
  async openCase(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(openCaseSchema)) body: OpenCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.cases.openCase({ tenantId, actor, dto: body, correlationId: correlationId ?? null });
  }

  @ApiOperation({ summary: 'Mis casos' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('cases')
  async listCases(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listCasesQuerySchema)) query: ListCasesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.read.listOwnCases({ tenantId, actor, query });
  }

  @ApiOperation({ summary: 'Detalle de mi caso' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 403, description: 'SUPPORT_CASE_FORBIDDEN: el caso no es de este cliente.' })
  @Get('cases/:caseId')
  async getCase(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.read.getCase({ tenantId, actor, caseId });
  }

  @ApiOperation({ summary: 'Pedir el cierre de mi caso' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('cases/:caseId/close-request')
  async closeRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(closeCaseSchema)) body: CloseCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.customerActions.registerCustomerRequest({ tenantId, actor, caseId, kind: 'CLOSE', reason: body.reason });
  }

  @ApiOperation({ summary: 'Pedir la reapertura de mi caso' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 409, description: 'SUPPORT_REOPEN_WINDOW_EXPIRED: abre un caso nuevo enlazado.' })
  @Post('cases/:caseId/reopen')
  async reopen(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(reopenCaseSchema)) body: ReopenCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.closure.reopen({ tenantId, actor, caseId, dto: body });
  }

  @ApiOperation({ summary: 'Valorar la atención recibida' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('cases/:caseId/feedback')
  async feedback(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(caseFeedbackSchema)) body: CaseFeedbackDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.customerActions.submitFeedback({ tenantId, actor, caseId, dto: body });
  }
}
