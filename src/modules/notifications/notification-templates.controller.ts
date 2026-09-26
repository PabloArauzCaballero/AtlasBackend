/**
 * @file Las plantillas y las preferencias que la consola administra.
 * @business Un aviso que no llega, o que llega por donde no se quiere, cuesta confianza.
 * @system expone este tramo del módulo de notificaciones.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { NotificationsService } from './notifications.service.js';
import {
  createTemplateSchema,
  listTemplatesQuerySchema,
  preferencesParamsSchema,
  templateIdParamsSchema,
  updatePreferencesSchema,
  updateTemplateSchema,
  CreateTemplateDto,
  ListTemplatesQueryDto,
  PreferencesParamsDto,
  UpdatePreferencesDto,
  UpdateTemplateDto,
} from './notifications.schemas.js';

/**
 * Aquí queda lo que se CONFIGURA —el texto con el que Atlas habla y por qué canal acepta hablar
 * cada cliente—, frente a `notifications.controller.ts`, que opera los mensajes en vuelo.
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NotificationTemplatesController {
  constructor(private readonly service: NotificationsService) {}

  @ApiOperation({ summary: 'Listar plantillas de notificación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'code', required: false, schema: zodObjectPropertySchemas(listTemplatesQuerySchema).code })
  @ApiQuery({ name: 'channel', required: false, schema: zodObjectPropertySchemas(listTemplatesQuerySchema).channel })
  @ApiQuery({ name: 'active', required: false, schema: zodObjectPropertySchemas(listTemplatesQuerySchema).active })
  @ApiResponse({ status: 200, description: 'Lista paginada de plantillas.' })
  @Get('operations/notifications/templates')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  listTemplates(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listTemplatesQuerySchema)) query: ListTemplatesQueryDto) {
    return this.service.listTemplates(tenantId, query);
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
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createTemplateSchema)) body: CreateTemplateDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.createTemplate(tenantId, body);
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
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(templateIdParamsSchema)) params: { templateId: string },
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: UpdateTemplateDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.updateTemplate(tenantId, params.templateId, body);
  }

  @ApiOperation({ summary: 'Preferencias de notificación de un cliente (operaciones)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(preferencesParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Preferencias del cliente por evento/canal.' })
  @Get('operations/notifications/preferences/:customerId')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  getPreferences(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(preferencesParamsSchema)) params: PreferencesParamsDto) {
    return this.service.getPreferences(tenantId, params.customerId);
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
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(preferencesParamsSchema)) params: PreferencesParamsDto,
    @Body(new ZodValidationPipe(updatePreferencesSchema)) body: UpdatePreferencesDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.updatePreferences(tenantId, params.customerId, body);
  }
}
