/**
 * @file Adaptador HTTP: la mesa de trabajo del equipo de soporte.
 * @business Ver la cola, tomar un caso, clasificarlo, escalarlo, resolverlo y cerrarlo.
 * @system exige perfil de agente además del rol; cada acción deja evento y auditoría.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { SupportCaseClosureService } from './application/support-case-closure.service.js';
import { SupportCaseEscalationService } from './application/support-case-escalation.service.js';
import { SupportCaseReadService } from './application/support-case-read.service.js';
import { SupportCaseWorkflowService } from './application/support-case-workflow.service.js';
import {
  type AssignCaseDto,
  assignCaseSchema,
  type CloseCaseDto,
  closeCaseSchema,
  type EscalateCaseDto,
  escalateCaseSchema,
  type InternalNoteDto,
  internalNoteSchema,
  type LinkCaseDto,
  linkCaseSchema,
  type ListCasesQueryDto,
  listCasesQuerySchema,
  type ResolveCaseDto,
  resolveCaseSchema,
  type TriageCaseDto,
  triageCaseSchema,
} from './support-case.schemas.js';

/**
 * La consola del agente.
 *
 * Todas las rutas exigen, además del rol interno, un PERFIL DE AGENTE vivo: tener rol de analista no
 * habilita a atender clientes. La comprobación vive en el servicio y no en el guard porque depende
 * de la base —quién está habilitado hoy—, no del token.
 */
@ApiTags('Interno · Soporte')
@ApiBearerAuth('access-token')
@Controller('internal/support/cases')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
export class InternalSupportController {
  constructor(
    private readonly actors: SupportActorService,
    private readonly read: SupportCaseReadService,
    private readonly workflow: SupportCaseWorkflowService,
    private readonly escalation: SupportCaseEscalationService,
    private readonly closure: SupportCaseClosureService,
  ) {}

  @ApiOperation({ summary: 'Cola de trabajo: casos abiertos por cola, prioridad y antigüedad' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get()
  async workQueue(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listCasesQuerySchema)) query: ListCasesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.read.listWorkQueue({ tenantId, actor, query });
  }

  @ApiOperation({ summary: 'Detalle operativo del caso' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 403, description: 'SUPPORT_CASE_RESTRICTED: expediente sensible no asignado.' })
  @Get(':caseId')
  async detail(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.read.getCase({ tenantId, actor, caseId });
  }

  @ApiOperation({ summary: 'Historia completa del expediente, con hashes verificables' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get(':caseId/timeline')
  async timeline(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.read.getTimeline({ tenantId, actor, caseId });
  }

  @ApiOperation({ summary: 'Clasificar o reclasificar el caso' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post(':caseId/triage')
  @HttpCode(HttpStatus.OK)
  async triage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(triageCaseSchema)) body: TriageCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.workflow.triage({ tenantId, actor, caseId, dto: body });
  }

  @ApiOperation({ summary: 'Tomar el caso (o asignarlo, si eres supervisor)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 403, description: 'SUPPORT_ASSIGN_REQUIRES_SUPERVISOR al asignar a otra persona.' })
  @Post(':caseId/claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(assignCaseSchema)) body: AssignCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.workflow.assign({ tenantId, actor, caseId, dto: body });
  }

  @ApiOperation({ summary: 'Transferir el caso, dejando el contexto para quien sigue' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post(':caseId/transfer')
  @HttpCode(HttpStatus.OK)
  async transfer(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(assignCaseSchema)) body: AssignCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.workflow.transfer({ tenantId, actor, caseId, dto: body });
  }

  @ApiOperation({ summary: 'Escalar (funcional, jerárquico, seguridad, fraude o privacidad)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post(':caseId/escalate')
  @HttpCode(HttpStatus.OK)
  async escalate(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(escalateCaseSchema)) body: EscalateCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.escalation.escalate({ tenantId, actor, caseId, dto: body });
  }

  @ApiOperation({ summary: 'Nota interna (nunca visible para el cliente)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post(':caseId/notes')
  async note(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(internalNoteSchema)) body: InternalNoteDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.escalation.addInternalNote({ tenantId, actor, caseId, dto: body });
  }

  @ApiOperation({ summary: 'Enlazar con otro caso (duplicado, causa, incidente mayor)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post(':caseId/links')
  async link(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(linkCaseSchema)) body: LinkCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.escalation.link({ tenantId, actor, caseId, dto: body });
  }

  @ApiOperation({ summary: 'Resolver: documenta y comunica la solución' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post(':caseId/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(resolveCaseSchema)) body: ResolveCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.closure.resolve({ tenantId, actor, caseId, dto: body });
  }

  @ApiOperation({ summary: 'Cerrar el expediente' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 409, description: 'SUPPORT_CASE_WITHOUT_RESOLUTION: documenta antes de cerrar.' })
  @Post(':caseId/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(closeCaseSchema)) body: CloseCaseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.closure.close({ tenantId, actor, caseId, dto: body });
  }
}
