/**
 * @file Lo que el TITULAR ve de sus notificaciones.
 * @business Un aviso que no llega, o que llega por donde no se quiere, cuesta confianza.
 * @system expone este tramo del módulo de notificaciones.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { NotificationsService } from './notifications.service.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../common/utils/auth/ownership.util.js';
import {
  customerNotificationIdParamsSchema,
  customerNotificationsParamsSchema,
  customerNotificationsQuerySchema,
  preferencesParamsSchema,
  updatePreferencesSchema,
  CustomerNotificationIdParamsDto,
  CustomerNotificationsParamsDto,
  CustomerNotificationsQueryDto,
  PreferencesParamsDto,
  UpdatePreferencesDto,
} from './notifications.schemas.js';

/**
 * Sale de `NotificationsController` porque aquel archivo servía a dos públicos con permisos muy
 * distintos —la consola interna, que opera notificaciones de OTROS, y el autoservicio, que sólo
 * toca las propias— y con 455 líneas pasaba del límite de `check:file-size`. Separados, el rol que
 * protege cada ruta se lee de un vistazo.
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerNotificationsController {
  constructor(private readonly service: NotificationsService) {}

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
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @Query(new ZodValidationPipe(customerNotificationsQuerySchema)) query: CustomerNotificationsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listCustomerNotifications(tenantId, params.customerId, query, currentUser);
  }

  @ApiOperation({
    summary: 'Preferencias de notificación del PROPIO cliente',
    description:
      'Las mismas preferencias que operaciones administra, leídas por su dueño. Existían solo bajo `operations/`, ' +
      'así que el cliente no podía ver —ni menos elegir— por qué canal se le avisa de su propia deuda.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiResponse({ status: 200, description: 'Preferencias del cliente, con las obligatorias marcadas.' })
  @Get('customers/:customerId/notification-preferences')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  getOwnPreferences(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(preferencesParamsSchema)) params: PreferencesParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    return this.service.getPreferences(tenantId, params.customerId);
  }

  @ApiOperation({
    summary: 'Cambiar sus propias preferencias de notificación',
    description:
      'El cliente elige por dónde se le avisa. NO puede apagar las obligatorias —vencimientos, mora, cambios en su ' +
      'línea—: son las que le protegen de enterarse tarde de una deuda suya, y apagarlas sería dejar de avisarle de ' +
      'lo único que no puede permitirse ignorar. Responde `REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED`.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiBody({ schema: zodToApiSchema(updatePreferencesSchema) })
  @ApiResponse({ status: 200, description: 'Preferencias actualizadas.' })
  @ApiResponse({ status: 400, description: 'REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED.' })
  @Patch('customers/:customerId/notification-preferences')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  updateOwnPreferences(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(preferencesParamsSchema)) params: PreferencesParamsDto,
    @Body(new ZodValidationPipe(updatePreferencesSchema)) body: UpdatePreferencesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    return this.service.updatePreferences(tenantId, params.customerId, body);
  }

  @ApiOperation({ summary: 'Contador de notificaciones no leídas del cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerNotificationsParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Cantidad de notificaciones no leídas.' })
  @ApiResponse({ status: 403, description: 'CUSTOMER_NOTIFICATION_ACCESS_DENIED.' })
  @Get('customers/:customerId/notifications/unread-count')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  unreadCount(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.unreadCount(tenantId, params.customerId, currentUser);
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
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerNotificationIdParamsSchema)) params: CustomerNotificationIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.markCustomerNotificationRead(tenantId, params.customerId, params.notificationId, currentUser);
  }
}
