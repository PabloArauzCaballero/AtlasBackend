/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { requireIdempotencyKey, tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import {
  applyRetentionPoliciesSchema,
  purgeIdempotencyKeysSchema,
  PurgeIdempotencyKeysDto,
  retryStuckNotificationsSchema,
  RetryStuckNotificationsDto,
  deliverPendingNotificationsSchema,
  DeliverPendingNotificationsDto,
  expireStaleSessionsSchema,
  processOutboxSchema,
  processEventsSchema,
  recalculateDataQualitySchema,
  ApplyRetentionPoliciesDto,
  ExpireStaleSessionsDto,
  ProcessEventsDto,
  ProcessOutboxDto,
  RecalculateDataQualityDto,
} from './runtime-jobs.schemas.js';
import { RuntimeMaintenanceJobsService } from './runtime-maintenance-jobs.service.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';

function requireHeaders(tenantIdHeader: string | undefined, idempotencyKey: string | undefined): string {
  requireIdempotencyKey(idempotencyKey);
  return tenantIdFromHeader(tenantIdHeader);
}

@ApiTags('runtime-jobs')
@ApiBearerAuth('access-token')
@Controller('operations/jobs')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'system')
export class RuntimeJobsController {
  constructor(
    private readonly service: RuntimeJobsService,
    private readonly maintenance: RuntimeMaintenanceJobsService,
  ) {}

  @ApiOperation({
    summary: 'Procesar el outbox de eventos pendientes',
    description: 'Job de mantenimiento. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(processOutboxSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del procesamiento del outbox.' })
  @Post('process-outbox')
  @HttpCode(HttpStatus.OK)
  processOutbox(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(processOutboxSchema)) body: ProcessOutboxDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.processOutbox({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }

  @ApiOperation({
    summary: 'Procesar eventos de dominio pendientes',
    description: 'Job de mantenimiento. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(processEventsSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del procesamiento de eventos.' })
  @Post('process-events')
  @HttpCode(HttpStatus.OK)
  processEvents(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(processEventsSchema)) body: ProcessEventsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.processEvents({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }

  @ApiOperation({ summary: 'Expirar sesiones inactivas', description: 'Job de mantenimiento. Restringido a admin/platform_admin/system.' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(expireStaleSessionsSchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la expiración de sesiones.' })
  @Post('expire-stale-sessions')
  @HttpCode(HttpStatus.OK)
  expireStaleSessions(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(expireStaleSessionsSchema)) body: ExpireStaleSessionsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.expireStaleSessions({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }

  @ApiOperation({
    summary: 'Reintentar notificaciones atascadas',
    description:
      'Reintenta los mensajes que quedaron en pending/sending (p. ej. porque el proceso se reinició a ' +
      'mitad de un broadcast). Job de mantenimiento. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(retryStuckNotificationsSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del reintento de notificaciones atascadas.' })
  @Post('retry-stuck-notifications')
  @HttpCode(HttpStatus.OK)
  retryStuckNotifications(
    // Endpoints NUEVOS: usan `@CurrentTenant()` en vez de repetir el parseo manual del header, que es
    // la deuda que congela `yarn check:tenant-header` (ATLAS-SEC-002). Los de arriba se migrarán
    // cuando se toquen por otra razón.
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(retryStuckNotificationsSchema)) body: RetryStuckNotificationsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.maintenance.retryStuckNotifications({ tenantId, body, currentUser });
  }

  @ApiOperation({
    summary: 'Entregar notificaciones pendientes',
    description:
      'Entrega los mensajes que el request dejó en pending cuando NOTIFICATIONS_DELIVERY_MODE=deferred. ' +
      'A diferencia de retry-stuck-notifications, no aplica corte por antigüedad: busca lo recién creado. ' +
      'Job de mantenimiento. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(deliverPendingNotificationsSchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la entrega de notificaciones pendientes.' })
  @Post('deliver-pending-notifications')
  @HttpCode(HttpStatus.OK)
  deliverPendingNotifications(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(deliverPendingNotificationsSchema)) body: DeliverPendingNotificationsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.maintenance.deliverPendingNotifications({ tenantId, body, currentUser });
  }

  @ApiOperation({
    summary: 'Purgar claves de idempotencia resueltas',
    description:
      'Borra las claves completed/failed anteriores al período de retención. Las claves en processing ' +
      'nunca se tocan: podrían pertenecer a una petición en vuelo. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(purgeIdempotencyKeysSchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la purga de claves de idempotencia.' })
  @Post('purge-idempotency-keys')
  @HttpCode(HttpStatus.OK)
  purgeIdempotencyKeys(
    // Endpoints NUEVOS: usan `@CurrentTenant()` en vez de repetir el parseo manual del header, que es
    // la deuda que congela `yarn check:tenant-header` (ATLAS-SEC-002). Los de arriba se migrarán
    // cuando se toquen por otra razón.
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(purgeIdempotencyKeysSchema)) body: PurgeIdempotencyKeysDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.maintenance.purgeIdempotencyKeys({ tenantId, body, currentUser });
  }

  @ApiOperation({
    summary: 'Aplicar políticas de retención de datos',
    description: 'Job de mantenimiento. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(applyRetentionPoliciesSchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la aplicación de políticas de retención.' })
  @Post('apply-retention-policies')
  @HttpCode(HttpStatus.OK)
  applyRetentionPolicies(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(applyRetentionPoliciesSchema)) body: ApplyRetentionPoliciesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.applyRetentionPolicies({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }

  @ApiOperation({
    summary: 'Recalcular métricas de calidad de datos',
    description: 'Job de mantenimiento. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(recalculateDataQualitySchema) })
  @ApiResponse({ status: 200, description: 'Resultado del recálculo de calidad de datos.' })
  @Post('recalculate-data-quality')
  @HttpCode(HttpStatus.OK)
  recalculateDataQuality(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(recalculateDataQualitySchema)) body: RecalculateDataQualityDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.recalculateDataQuality({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }
}
