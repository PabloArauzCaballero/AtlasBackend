/**
 * @file El envío masivo, aparte de la operación mensaje a mensaje.
 * @business Un aviso que no llega, o que llega por donde no se quiere, cuesta confianza.
 * @system expone este tramo del módulo de notificaciones.
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { NotificationsService } from './notifications.service.js';
import { createBroadcastNotificationSchema, CreateBroadcastNotificationDto } from './notifications.schemas.js';

/**
 * Va en su propio controlador porque es la única ruta que escribe a MUCHOS destinatarios a la vez:
 * el resto del módulo opera un mensaje concreto que ya existe.
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NotificationBroadcastController {
  constructor(private readonly service: NotificationsService) {}

  @ApiOperation({
    summary: 'Enviar notificación in-app personalizada (broadcast de admin)',
    description:
      'Crea y entrega una notificación in-app real a customers y/o usuarios internos — a los ids indicados, o a todos los activos del tenant si no se indican. No usa email/SMS/push (esos canales siguen disponibles vía plantillas de eventos de dominio).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(createBroadcastNotificationSchema) })
  @ApiResponse({
    status: 202,
    description:
      'Broadcast aceptado — los mensajes se crearon (devuelve targeted/created) y la entrega corre en background (status: "queued"). Un broadcast grande no bloquea el request.',
  })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente, o customerIds/internalUserIds usado con la audience equivocada.' })
  @Post('operations/notifications/broadcast')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('admin', 'platform_admin', 'system')
  broadcastNotification(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createBroadcastNotificationSchema)) body: CreateBroadcastNotificationDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.broadcast(tenantId, body);
  }
}
