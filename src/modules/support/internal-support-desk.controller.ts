/**
 * @file Adaptador HTTP: la cola de conversaciones, la presencia del agente y el conocimiento interno.
 * @business Permite tomar chats en espera, declararse disponible y publicar respuestas aprobadas.
 * @system separa la mesa (canales y presencia) del expediente para no crecer un solo controlador.
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { SupportChannelService } from './application/support-channel.service.js';
import { SupportDeskService } from './application/support-desk.service.js';
import { SupportMessageService } from './application/support-message.service.js';
import { SupportSlaService } from './application/support-sla.service.js';
import { type CreateAgentProfileDto, createAgentProfileSchema, type PresenceDto, presenceSchema } from './support-case.schemas.js';

@ApiTags('Interno · Mesa de soporte')
@ApiBearerAuth('access-token')
@Controller('internal/support/desk')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
export class InternalSupportDeskController {
  constructor(
    private readonly actors: SupportActorService,
    private readonly channels: SupportChannelService,
    private readonly desk: SupportDeskService,
    private readonly messages: SupportMessageService,
    private readonly sla: SupportSlaService,
  ) {}

  @ApiOperation({ summary: 'Conversaciones en espera de agente' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('queue')
  async queue(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query('queueId') queueId: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.desk.listQueuedChannels({ tenantId, actor, queueId: queueId ?? null });
  }

  /**
   * Declararse disponible.
   *
   * La presencia es efímera y el peor caso de perderla es no recibir chats nuevos: nunca se pierde
   * una conversación por ello. La CAPACIDAD, en cambio, vive en la base porque de ella depende que
   * dos agentes no se queden con el mismo canal.
   */
  @ApiOperation({ summary: 'Cambiar mi estado de presencia' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('presence')
  @HttpCode(HttpStatus.OK)
  async presence(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(presenceSchema)) body: PresenceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.desk.setPresence({ tenantId, actor, presenceState: body.presenceState });
  }

  @ApiOperation({ summary: 'Tomar una conversación en espera' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 409, description: 'SUPPORT_CHANNEL_ALREADY_CLAIMED o SUPPORT_AGENT_AT_CAPACITY.' })
  @Post('channels/:channelId/claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.channels.claimChannel({ tenantId, actor, channelId });
  }

  /**
   * Verificación de integridad de una conversación.
   *
   * Recalcula la cadena de hash y dice si cuadra y, si no, en qué posición dejó de cuadrar. Un
   * resultado inválido no es un dato curioso: significa que alguien escribió en la base sorteando
   * los triggers, y eso se trata como incidente de seguridad.
   */
  @ApiOperation({ summary: 'Verificar la cadena de integridad de una conversación' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('channels/:channelId/integrity')
  async integrity(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    this.actors.assertIsAgent(actor);
    return this.messages.verifyIntegrity(channelId);
  }

  /**
   * Quién está habilitado para atender.
   *
   * Lo administra un supervisor y no cualquier interno: habilitar agentes decide quién puede LEER
   * expedientes de soporte, que llevan dentro la conversación completa con el cliente.
   */
  @ApiOperation({ summary: 'Perfiles de agente habilitados en la mesa' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('agents')
  @Roles('admin', 'platform_admin')
  async agents(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.desk.listAgents({ tenantId: tenantIdFromHeader(tenantIdHeader, currentUser) });
  }

  /**
   * Habilitar a una persona interna como agente.
   *
   * Es el alta que faltaba en todo el circuito. Sin perfil, cada ruta de esta consola responde 403
   * `SUPPORT_AGENT_PROFILE_REQUIRED` —también a un administrador con todos los permisos— y hasta hoy
   * la única forma de crearlo era escribir SQL contra `support.support_agent_profiles`.
   */
  @ApiOperation({ summary: 'Habilitar a un usuario interno como agente de soporte' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 404, description: 'SUPPORT_INTERNAL_USER_NOT_FOUND o SUPPORT_QUEUE_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'SUPPORT_AGENT_PROFILE_EXISTS: ya tiene perfil activo.' })
  @Post('agents')
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin', 'platform_admin')
  async createAgent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(createAgentProfileSchema)) body: CreateAgentProfileDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.desk.createAgent({ tenantId: tenantIdFromHeader(tenantIdHeader, currentUser), body });
  }

  @ApiOperation({ summary: 'Quitar a un agente de la mesa (no borra su historia)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 404, description: 'SUPPORT_AGENT_PROFILE_NOT_FOUND.' })
  @Delete('agents/:agentProfileId')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'platform_admin')
  async deactivateAgent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('agentProfileId') agentProfileId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.desk.deactivateAgent({ tenantId: tenantIdFromHeader(tenantIdHeader, currentUser), agentProfileId });
  }

  /**
   * Barrido manual de incumplimientos de SLA.
   *
   * Existe además del barrido programado porque un supervisor necesita poder forzar la revisión
   * antes de un comité, sin esperar al siguiente ciclo del job.
   */
  @ApiOperation({ summary: 'Marcar los SLA vencidos y publicar sus eventos' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post('sla/sweep')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'platform_admin')
  async sweep(@Headers('x-tenant-id') tenantIdHeader: string | undefined) {
    return this.sla.sweepBreaches(tenantIdFromHeader(tenantIdHeader));
  }
}
