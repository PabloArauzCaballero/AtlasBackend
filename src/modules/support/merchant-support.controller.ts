/**
 * @file Adaptador HTTP: el centro de soporte del comercio, desde el portal.
 * @business El comercio abre casos de su operación y consulta la ayuda escrita para comercios.
 * @system mismas reglas que el consumidor, con el aislamiento entre comercios resuelto en el actor.
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
} from './support-case.schemas.js';
import { type KnowledgeSearchDto, knowledgeSearchSchema } from './support-knowledge.schemas.js';

/**
 * Soporte del comercio.
 *
 * El `partnerProfileId` viaja en el cuerpo porque un mismo usuario puede administrar más de un
 * comercio, pero NO se confía en él: el servicio comprueba contra el dueño del expediente. Confiar
 * en el identificador que envía quien llama convierte la comprobación en una formalidad que el
 * propio atacante controla.
 */
@ApiTags('Merchant · Soporte')
@ApiBearerAuth('access-token')
@Controller('merchant/support')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('merchant', 'internal_operator', 'admin', 'platform_admin')
export class MerchantSupportController {
  constructor(
    private readonly actors: SupportActorService,
    private readonly cases: SupportCaseService,
    private readonly read: SupportCaseReadService,
    private readonly customerActions: SupportCaseCustomerService,
    private readonly knowledge: SupportKnowledgeService,
  ) {}

  @ApiOperation({ summary: 'Preguntas frecuentes para comercios' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('faq')
  async faq(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.knowledge.featuredFaq({ tenantId, actor });
  }

  @ApiOperation({ summary: 'Motivos por los que el comercio puede abrir un caso' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Árbol de motivo y submotivo para la audiencia del comercio.' })
  @Get('categories')
  async categories(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.cases.listCategories({ tenantId, actor });
  }

  @ApiOperation({ summary: 'Buscar en la ayuda para comercios' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
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

  @ApiOperation({ summary: 'Abrir un caso del comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 201, description: 'Caso creado con su canal asíncrono.' })
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

  @ApiOperation({ summary: 'Casos de mi usuario en este comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('partners/:partnerProfileId/cases')
  async listCases(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('partnerProfileId') partnerProfileId: string,
    @Query(new ZodValidationPipe(listCasesQuerySchema)) query: ListCasesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.read.listOwnCases({ tenantId, actor, query, partnerProfileId });
  }

  @ApiOperation({ summary: 'Detalle de un caso del comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 403, description: 'SUPPORT_CASE_FORBIDDEN: el caso es de otro comercio.' })
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

  @ApiOperation({ summary: 'Pedir el cierre de un caso del comercio' })
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
