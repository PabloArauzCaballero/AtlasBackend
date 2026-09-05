/**
 * @file Adaptador HTTP: el canal de conversación de soporte, para cliente y comercio.
 * @business Hablar con un agente, ver lo que se dijo y cerrar la conversación sin cerrar el caso.
 * @system un solo controlador para ambas audiencias: la separación la impone el actor, no la ruta.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, type MessageEvent, Param, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { type Observable, filter, map } from 'rxjs';
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
import { SupportConversationService } from './application/support-conversation.service.js';
import { SupportMessageService } from './application/support-message.service.js';
import { SupportRealtimeService } from './application/support-realtime.service.js';
import {
  type CloseChannelDto,
  closeChannelSchema,
  type CorrectMessageDto,
  correctMessageSchema,
  type OpenChannelDto,
  openChannelSchema,
  type SendMessageDto,
  sendMessageSchema,
  type MarkReadDto,
  markReadSchema,
  type TranscriptQueryDto,
  transcriptQuerySchema,
} from './support-case.schemas.js';

/**
 * La conversación.
 *
 * Un único controlador para consumidor, comercio y agente: quién puede hacer qué lo decide el actor
 * resuelto desde el token y la participación viva en el canal, no la ruta por la que se entró.
 * Rutas separadas por audiencia habrían obligado a repetir la comprobación tres veces, y basta
 * olvidarla en una para abrir la conversación de un cliente a cualquiera.
 *
 * `x-tenant-id` es OPCIONAL en todo el módulo: cuando no viene se usa el del token. El portal del
 * comercio no lo envía —su cliente HTTP nunca lo puso— y exigirlo habría dejado el chat fuera del
 * ERP por una cabecera. Cuando sí viene, `TenantGuard` comprueba que coincida con el token, así que
 * aceptarlo opcional no relaja nada.
 */
@ApiTags('Soporte · Conversación')
@ApiBearerAuth('access-token')
@Controller('support/channels')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'merchant', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
export class SupportChatController {
  constructor(
    private readonly actors: SupportActorService,
    private readonly channels: SupportChannelService,
    private readonly messages: SupportMessageService,
    private readonly conversation: SupportConversationService,
    private readonly realtime: SupportRealtimeService,
  ) {}

  @ApiOperation({ summary: 'Pedir atención: abre el canal y asigna un agente elegible' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 201, description: 'Canal abierto con agente, o encolado si no hay ninguno libre.' })
  @Post()
  async open(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(openChannelSchema)) body: OpenChannelDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.channels.requestChannel({ tenantId, actor, dto: body });
  }

  @ApiOperation({ summary: 'Enviar un mensaje' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Mensaje añadido; reintentar con el mismo clientMessageId no duplica.' })
  @ApiResponse({ status: 403, description: 'SUPPORT_CHANNEL_NOT_PARTICIPANT o SUPPORT_CHANNEL_CLOSED.' })
  @Post(':channelId/messages')
  @HttpCode(HttpStatus.OK)
  async send(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Param('channelId') channelId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.messages.send({ tenantId, actor, channelId, dto: body, correlationId: correlationId ?? null });
  }

  /**
   * La transcripción, paginada hacia atrás por secuencia.
   *
   * No hay `offset`: una conversación larga lo volvería lento justo cuando más historia hay que
   * revisar. Las notas internas se incluyen o no según el actor, nunca según un parámetro.
   */
  @ApiOperation({ summary: 'Leer la conversación' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get(':channelId/messages')
  async transcript(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @Query(new ZodValidationPipe(transcriptQuerySchema)) query: TranscriptQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.conversation.transcript({ tenantId, actor, channelId, query });
  }

  /**
   * Corregir un mensaje propio.
   *
   * No existe `PUT /messages/{id}`: la corrección crea un mensaje nuevo enlazado al anterior, y el
   * original se queda donde está porque la otra parte ya lo leyó.
   */
  @ApiOperation({ summary: 'Corregir un mensaje ya enviado (crea uno nuevo enlazado)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 403, description: 'SUPPORT_MESSAGE_NOT_OWN: sólo su autor puede corregirlo.' })
  @Post(':channelId/messages/:messageId/corrections')
  async correct(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(correctMessageSchema)) body: CorrectMessageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.conversation.correct({ tenantId, actor, channelId, messageId, dto: body });
  }

  @ApiOperation({ summary: 'Cerrar la conversación (el caso sigue su curso)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Canal cerrado; el expediente conserva su estado.' })
  @Post(':channelId/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @Body(new ZodValidationPipe(closeChannelSchema)) body: CloseChannelDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.channels.closeChannel({ tenantId, actor, channelId, dto: body });
  }

  /**
   * El hilo en vivo de la conversación (SSE).
   *
   * Es lo que hace que el mensaje del otro APAREZCA en vez de esperar a que alguien recargue. Va
   * por SSE y no por WebSocket porque el envío ya tiene su `POST` idempotente y aquí sólo hace
   * falta el sentido servidor→cliente: HTTP normal, reconexión automática del navegador y ningún
   * puerto ni librería extra.
   *
   * ## Lo que este endpoint NO es
   *
   * No es la fuente de la conversación. Si el proceso muere o el cliente estuvo desconectado, pide
   * la transcripción por `beforeSequence` y recupera todo: los mensajes viven en PostgreSQL. Perder
   * un evento aquí cuesta un refresco, no un mensaje — por eso el bus puede ser efímero.
   *
   * Las notas internas se filtran ANTES de salir: quien no es del equipo no recibe siquiera el
   * aviso de que existen.
   *
   * ## Formato de cada evento
   *
   * Cada línea `data:` trae un JSON con `{ type, data }` — el tipo viaja DENTRO del payload y no
   * como nombre de evento SSE. El cliente hace `JSON.parse(e.data).type` y decide. Es lo que emite
   * este runtime y está verificado contra el stream real; documentarlo de otra forma haría que el
   * frontend escuchara nombres de evento que nunca llegan.
   */
  @ApiOperation({ summary: 'Hilo en vivo de la conversación (Server-Sent Events)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Stream `text/event-stream`; cada `data:` es {type, data} con message.created, message.read o agent.typing.' })
  @Sse(':channelId/stream')
  async stream(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<Observable<MessageEvent>> {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    await this.messages.assertParticipates(tenantId, channelId, actor);

    return this.realtime.sseFor(tenantId, channelId).pipe(
      filter((event) => actor.isInternal || event.data.visibility !== 'INTERNAL'),
      map((event) => ({ type: event.type, data: event.data }) as MessageEvent),
    );
  }

  @ApiOperation({ summary: 'Marcar hasta dónde leí (doble tic para la otra parte)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post(':channelId/read')
  @HttpCode(HttpStatus.OK)
  async read(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @Body(new ZodValidationPipe(markReadSchema)) body: MarkReadDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.conversation.markRead({ tenantId, actor, channelId, upToSequence: body.upToSequence });
  }

  @ApiOperation({ summary: 'Avisar que estoy escribiendo (efímero, no se guarda)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Post(':channelId/typing')
  @HttpCode(HttpStatus.NO_CONTENT)
  async typing(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    await this.conversation.announceTyping({ tenantId, actor, channelId });
  }

  @ApiOperation({ summary: 'Mis conversaciones con mensajes sin leer' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @Get('unread')
  async unread(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    const tenantId = tenantIdFromHeader(tenantIdHeader, currentUser);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.conversation.unread({ tenantId, actor });
  }
}
