import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { requireIdempotencyKey, tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { NotificationsService } from './notifications.service.js';
import {
  createBroadcastNotificationSchema,
  createTemplateSchema,
  customerNotificationIdParamsSchema,
  customerNotificationsParamsSchema,
  customerNotificationsQuerySchema,
  deviceTokenIdParamsSchema,
  internalUserNotificationIdParamsSchema,
  listMessagesQuerySchema,
  listTemplatesQuerySchema,
  messageIdParamsSchema,
  preferencesParamsSchema,
  templateIdParamsSchema,
  updatePreferencesSchema,
  updateTemplateSchema,
  upsertDeviceTokenSchema,
  CreateBroadcastNotificationDto,
  CreateTemplateDto,
  CustomerNotificationIdParamsDto,
  CustomerNotificationsParamsDto,
  CustomerNotificationsQueryDto,
  DeviceTokenIdParamsDto,
  InternalUserNotificationIdParamsDto,
  ListMessagesQueryDto,
  ListTemplatesQueryDto,
  MessageIdParamsDto,
  PreferencesParamsDto,
  UpdatePreferencesDto,
  UpdateTemplateDto,
  UpsertDeviceTokenDto,
} from './notifications.schemas.js';

// Todo rol legacy que `legacyRoleForInternalRoles` (internal-rbac.roles.ts) puede producir para
// un usuario interno real, más 'platform_admin'/'system' (actores de servicio). A diferencia de
// los roles usados en el resto de este controller (que gatean vistas ADMINISTRATIVAS sobre datos
// de OTROS), esta lista es para endpoints de autoservicio ("mis notificaciones") — cualquier
// usuario interno autenticado debe poder revisar SU PROPIO inbox sin importar su rol funcional.
// Antes de este fix, la lista omitía 'qa_engineer' y 'readonly_auditor': cualquier interno con
// esos roles recibía 403 al intentar ver notificaciones que el propio backend ya le había
// enviado (p. ej. una alerta de servicio caído), un bug real encontrado al integrar el frontend.
const INTERNAL_SELF_SERVICE_ROLES = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'qa_engineer',
  'readonly_auditor',
  'admin',
  'platform_admin',
  'system',
] as const;

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @ApiOperation({ summary: 'Listar mensajes de notificación (operaciones)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(listMessagesQuerySchema).status })
  @ApiQuery({ name: 'channel', required: false, schema: zodObjectPropertySchemas(listMessagesQuerySchema).channel })
  @ApiResponse({ status: 200, description: 'Lista paginada de mensajes.' })
  @Get('operations/notifications/messages')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  listMessages(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQueryDto,
  ) {
    return this.service.listMessages(tenantIdFromHeader(tenantIdHeader), query);
  }

  @ApiOperation({
    summary: 'Detalle de un mensaje de notificación (operaciones)',
    description: 'Incluye el historial de intentos de entrega (deliveries) del mensaje.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'messageId', schema: zodToApiSchema(messageIdParamsSchema.shape.messageId) })
  @ApiResponse({ status: 200, description: 'Detalle del mensaje con sus deliveries.' })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_MESSAGE_NOT_FOUND.' })
  @Get('operations/notifications/messages/:messageId')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  getMessage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(messageIdParamsSchema)) params: MessageIdParamsDto,
  ) {
    return this.service.getMessage(tenantIdFromHeader(tenantIdHeader), params.messageId);
  }

  @ApiOperation({ summary: 'Reintentar entrega de un mensaje fallido' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'messageId', schema: zodToApiSchema(messageIdParamsSchema.shape.messageId) })
  @ApiResponse({ status: 200, description: 'Reintento encolado — devuelve el mensaje actualizado.' })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente.' })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_MESSAGE_NOT_FOUND.' })
  @Post('operations/notifications/messages/:messageId/retry')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'platform_admin', 'system', 'internal_operator')
  retryMessage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(messageIdParamsSchema)) params: MessageIdParamsDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.retryMessage(tenantIdFromHeader(tenantIdHeader), params.messageId);
  }

  @ApiOperation({ summary: 'Cancelar un mensaje de notificación pendiente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'messageId', schema: zodToApiSchema(messageIdParamsSchema.shape.messageId) })
  @ApiResponse({ status: 200, description: 'Mensaje cancelado.' })
  @ApiResponse({ status: 400, description: 'SENT_MESSAGE_CANNOT_BE_CANCELLED — el mensaje ya fue enviado.' })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_MESSAGE_NOT_FOUND.' })
  @Post('operations/notifications/messages/:messageId/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'platform_admin', 'system', 'internal_operator')
  cancelMessage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(messageIdParamsSchema)) params: MessageIdParamsDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.cancelMessage(tenantIdFromHeader(tenantIdHeader), params.messageId);
  }

  @ApiOperation({ summary: 'Listar plantillas de notificación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'code', required: false, schema: zodObjectPropertySchemas(listTemplatesQuerySchema).code })
  @ApiQuery({ name: 'channel', required: false, schema: zodObjectPropertySchemas(listTemplatesQuerySchema).channel })
  @ApiQuery({ name: 'active', required: false, schema: zodObjectPropertySchemas(listTemplatesQuerySchema).active })
  @ApiResponse({ status: 200, description: 'Lista paginada de plantillas.' })
  @Get('operations/notifications/templates')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  listTemplates(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listTemplatesQuerySchema)) query: ListTemplatesQueryDto,
  ) {
    return this.service.listTemplates(tenantIdFromHeader(tenantIdHeader), query);
  }

  @ApiOperation({ summary: 'Crear plantilla de notificación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(createTemplateSchema) })
  @ApiResponse({ status: 201, description: 'Plantilla creada.' })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente.' })
  @Post('operations/notifications/templates')
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin', 'platform_admin', 'system')
  createTemplate(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createTemplateSchema)) body: CreateTemplateDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.createTemplate(tenantIdFromHeader(tenantIdHeader), body);
  }

  @ApiOperation({ summary: 'Editar plantilla de notificación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'templateId', schema: zodToApiSchema(templateIdParamsSchema.shape.templateId) })
  @ApiBody({ schema: zodToApiSchema(updateTemplateSchema) })
  @ApiResponse({ status: 200, description: 'Plantilla actualizada.' })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_TEMPLATE_NOT_FOUND.' })
  @Patch('operations/notifications/templates/:templateId')
  @Roles('admin', 'platform_admin', 'system')
  updateTemplate(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(templateIdParamsSchema)) params: { templateId: string },
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: UpdateTemplateDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.updateTemplate(tenantIdFromHeader(tenantIdHeader), params.templateId, body);
  }

  @ApiOperation({ summary: 'Preferencias de notificación de un cliente (operaciones)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(preferencesParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Preferencias del cliente por evento/canal.' })
  @Get('operations/notifications/preferences/:customerId')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  getPreferences(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(preferencesParamsSchema)) params: PreferencesParamsDto,
  ) {
    return this.service.getPreferences(tenantIdFromHeader(tenantIdHeader), params.customerId);
  }

  @ApiOperation({
    summary: 'Editar preferencias de notificación de un cliente (operaciones)',
    description: 'No puede desactivar notificaciones marcadas como requeridas (REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(preferencesParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(updatePreferencesSchema) })
  @ApiResponse({ status: 200, description: 'Preferencias actualizadas.' })
  @ApiResponse({ status: 400, description: 'REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED.' })
  @Patch('operations/notifications/preferences/:customerId')
  @Roles('admin', 'platform_admin', 'system', 'internal_operator')
  updatePreferences(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(preferencesParamsSchema)) params: PreferencesParamsDto,
    @Body(new ZodValidationPipe(updatePreferencesSchema)) body: UpdatePreferencesDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.updatePreferences(tenantIdFromHeader(tenantIdHeader), params.customerId, body);
  }

  @ApiOperation({
    summary: 'Enviar notificación in-app personalizada (broadcast de admin)',
    description:
      'Crea y entrega una notificación in-app real a customers y/o usuarios internos — a los ids indicados, o a todos los activos del tenant si no se indican. No usa email/SMS/push (esos canales siguen disponibles vía plantillas de eventos de dominio).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(createBroadcastNotificationSchema) })
  @ApiResponse({
    status: 201,
    description: 'Broadcast creado — devuelve cuántos destinatarios se targetearon y cuántos mensajes se crearon.',
  })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente, o customerIds/internalUserIds usado con la audience equivocada.' })
  @Post('operations/notifications/broadcast')
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin', 'platform_admin', 'system')
  broadcastNotification(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createBroadcastNotificationSchema)) body: CreateBroadcastNotificationDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.broadcast(tenantIdFromHeader(tenantIdHeader), body);
  }

  @ApiOperation({ summary: 'Listar notificaciones del cliente (autoservicio)' })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para customer (se toma del token).' })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerNotificationsParamsSchema.shape.customerId) })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(customerNotificationsQuerySchema).status })
  @ApiQuery({ name: 'channel', required: false, schema: zodObjectPropertySchemas(customerNotificationsQuerySchema).channel })
  @ApiResponse({ status: 200, description: 'Lista paginada de notificaciones del cliente.' })
  @ApiResponse({ status: 403, description: 'CUSTOMER_NOTIFICATION_ACCESS_DENIED.' })
  @Get('customers/:customerId/notifications')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  listCustomerNotifications(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @Query(new ZodValidationPipe(customerNotificationsQuerySchema)) query: CustomerNotificationsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listCustomerNotifications(tenantIdFromHeader(tenantIdHeader, currentUser), params.customerId, query, currentUser);
  }

  @ApiOperation({ summary: 'Contador de notificaciones no leídas del cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerNotificationsParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Cantidad de notificaciones no leídas.' })
  @ApiResponse({ status: 403, description: 'CUSTOMER_NOTIFICATION_ACCESS_DENIED.' })
  @Get('customers/:customerId/notifications/unread-count')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  unreadCount(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.unreadCount(tenantIdFromHeader(tenantIdHeader, currentUser), params.customerId, currentUser);
  }

  @ApiOperation({ summary: 'Marcar una notificación como leída' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerNotificationIdParamsSchema.shape.customerId) })
  @ApiParam({ name: 'notificationId', schema: zodToApiSchema(customerNotificationIdParamsSchema.shape.notificationId) })
  @ApiResponse({ status: 200, description: 'Notificación marcada como leída.' })
  @ApiResponse({ status: 403, description: 'CUSTOMER_NOTIFICATION_ACCESS_DENIED.' })
  @ApiResponse({ status: 404, description: 'CUSTOMER_NOTIFICATION_NOT_FOUND.' })
  @Post('customers/:customerId/notifications/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  markRead(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationIdParamsSchema)) params: CustomerNotificationIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.markCustomerNotificationRead(
      tenantIdFromHeader(tenantIdHeader, currentUser),
      params.customerId,
      params.notificationId,
      currentUser,
    );
  }

  @ApiOperation({ summary: 'Marcar todas las notificaciones del cliente como leídas' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerNotificationsParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Cantidad de notificaciones actualizadas.' })
  @ApiResponse({ status: 403, description: 'CUSTOMER_NOTIFICATION_ACCESS_DENIED.' })
  @Post('customers/:customerId/notifications/read-all')
  @HttpCode(HttpStatus.OK)
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  markAllRead(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.markAllCustomerNotificationsRead(tenantIdFromHeader(tenantIdHeader, currentUser), params.customerId, currentUser);
  }

  @ApiOperation({
    summary: 'Registrar/actualizar token de dispositivo (push)',
    description: 'Registra el token FCM/APNs del dispositivo del cliente para poder enviarle notificaciones push.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerNotificationsParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(upsertDeviceTokenSchema) })
  @ApiResponse({ status: 201, description: 'Token de dispositivo registrado.' })
  @ApiResponse({ status: 403, description: 'CUSTOMER_NOTIFICATION_ACCESS_DENIED.' })
  @Post('customers/:customerId/device-tokens')
  @HttpCode(HttpStatus.CREATED)
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  upsertDeviceToken(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @Body(new ZodValidationPipe(upsertDeviceTokenSchema)) body: UpsertDeviceTokenDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.upsertDeviceToken(tenantIdFromHeader(tenantIdHeader, currentUser), params.customerId, body, currentUser);
  }

  @ApiOperation({ summary: 'Desactivar token de dispositivo (push)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(deviceTokenIdParamsSchema.shape.customerId) })
  @ApiParam({ name: 'deviceTokenId', schema: zodToApiSchema(deviceTokenIdParamsSchema.shape.deviceTokenId) })
  @ApiResponse({ status: 200, description: 'Token de dispositivo desactivado.' })
  @ApiResponse({ status: 403, description: 'CUSTOMER_NOTIFICATION_ACCESS_DENIED.' })
  @ApiResponse({ status: 404, description: 'DEVICE_TOKEN_NOT_FOUND.' })
  @Delete('customers/:customerId/device-tokens/:deviceTokenId')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  deactivateDeviceToken(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(deviceTokenIdParamsSchema)) params: DeviceTokenIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.deactivateDeviceToken(
      tenantIdFromHeader(tenantIdHeader, currentUser),
      params.customerId,
      params.deviceTokenId,
      currentUser,
    );
  }

  // ---------------------------------------------------------------------------------------
  // Autoservicio de notificaciones del usuario interno autenticado ("me"): mismo patrón que el
  // inbox de customer, pero recipientId sale siempre del token (`currentUser.internalUserId`),
  // nunca de un parámetro de ruta — un usuario interno solo puede ver/marcar SUS notificaciones.
  // ---------------------------------------------------------------------------------------

  @ApiOperation({ summary: 'Listar mis notificaciones (usuario interno, autoservicio)' })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional (se toma del token).' })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(customerNotificationsQuerySchema).status })
  @ApiQuery({ name: 'channel', required: false, schema: zodObjectPropertySchemas(customerNotificationsQuerySchema).channel })
  @ApiResponse({ status: 200, description: 'Lista paginada de mis notificaciones.' })
  @ApiResponse({ status: 403, description: 'INTERNAL_USER_TOKEN_REQUIRED.' })
  @Get('internal-users/me/notifications')
  @Roles(...INTERNAL_SELF_SERVICE_ROLES)
  listMyNotifications(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(customerNotificationsQuerySchema)) query: CustomerNotificationsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listMyNotifications(tenantIdFromHeader(tenantIdHeader, currentUser), query, currentUser);
  }

  @ApiOperation({ summary: 'Contador de mis notificaciones no leídas (usuario interno)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Cantidad de notificaciones no leídas.' })
  @ApiResponse({ status: 403, description: 'INTERNAL_USER_TOKEN_REQUIRED.' })
  @Get('internal-users/me/notifications/unread-count')
  @Roles(...INTERNAL_SELF_SERVICE_ROLES)
  myUnreadNotificationsCount(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.myUnreadCount(tenantIdFromHeader(tenantIdHeader, currentUser), currentUser);
  }

  @ApiOperation({ summary: 'Marcar una de mis notificaciones como leída (usuario interno)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'notificationId', schema: zodToApiSchema(internalUserNotificationIdParamsSchema.shape.notificationId) })
  @ApiResponse({ status: 200, description: 'Notificación marcada como leída.' })
  @ApiResponse({ status: 403, description: 'INTERNAL_USER_TOKEN_REQUIRED.' })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_NOT_FOUND.' })
  @Post('internal-users/me/notifications/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  @Roles(...INTERNAL_SELF_SERVICE_ROLES)
  markMyNotificationRead(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(internalUserNotificationIdParamsSchema)) params: InternalUserNotificationIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.markMyNotificationRead(tenantIdFromHeader(tenantIdHeader, currentUser), params.notificationId, currentUser);
  }

  @ApiOperation({ summary: 'Marcar todas mis notificaciones como leídas (usuario interno)' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Cantidad de notificaciones actualizadas.' })
  @ApiResponse({ status: 403, description: 'INTERNAL_USER_TOKEN_REQUIRED.' })
  @Post('internal-users/me/notifications/read-all')
  @HttpCode(HttpStatus.OK)
  @Roles(...INTERNAL_SELF_SERVICE_ROLES)
  markAllMyNotificationsRead(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.markAllMyNotificationsRead(tenantIdFromHeader(tenantIdHeader, currentUser), currentUser);
  }
}
