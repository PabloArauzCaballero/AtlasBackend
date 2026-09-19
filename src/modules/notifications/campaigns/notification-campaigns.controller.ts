/**
 * @file Campañas de notificación: alta, programación, operación y resultados.
 * @business Operaciones arma una campaña (contenido, canales, segmento, ventana), la prueba, la
 *   programa y la sigue: cuántos la recibieron, por qué canal y cuántos la leyeron.
 * @system Escribir exige `admin`/`platform_admin`; leer también lo puede `internal_operator`. Toda
 *   mutación pide `x-idempotency-key`, igual que el broadcast.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { requireIdempotencyKey } from '../../../common/utils/http/headers.util.js';
import { listMessagesQuerySchema } from '../notifications.schemas.js';
import { NotificationCampaignAudienceService } from './notification-campaign-audience.service.js';
import { NotificationCampaignTestSendService } from './notification-campaign-test-send.service.js';
import { NotificationCampaignService } from './notification-campaign.service.js';
import {
  campaignIdParamsSchema,
  cancelCampaignSchema,
  createCampaignSchema,
  estimateAudienceSchema,
  listCampaignsQuerySchema,
  testSendCampaignSchema,
  updateCampaignSchema,
  type CancelCampaignDto,
  type CreateCampaignDto,
  type EstimateAudienceDto,
  type ListCampaignsQueryDto,
  type TestSendCampaignDto,
  type UpdateCampaignDto,
} from './notification-campaigns.schemas.js';

const READ_ROLES = ['internal_operator', 'admin', 'platform_admin', 'system'] as const;
const WRITE_ROLES = ['admin', 'platform_admin'] as const;

export function actorOf(user: AuthenticatedUser | undefined): string {
  return String(user?.internalUserId ?? user?.sub ?? 'unknown');
}

@ApiTags('notification-campaigns')
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'x-tenant-id', required: true })
@Controller('operations/notifications/campaigns')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NotificationCampaignsController {
  constructor(
    private readonly campaigns: NotificationCampaignService,
    private readonly audience: NotificationCampaignAudienceService,
    private readonly testSend: NotificationCampaignTestSendService,
  ) {}

  @ApiOperation({ summary: 'Listar campañas de notificación' })
  @Get()
  @Roles(...READ_ROLES)
  list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listCampaignsQuerySchema)) query: ListCampaignsQueryDto) {
    return this.campaigns.list(tenantId, query);
  }

  @ApiOperation({ summary: 'Crear una campaña en borrador', description: 'No envía nada: hay que programarla.' })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(createCampaignSchema) })
  @ApiResponse({ status: 201, description: 'Campaña creada en borrador (o la ya creada con esa clave de idempotencia).' })
  @Post()
  @Roles(...WRITE_ROLES)
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createCampaignSchema)) body: CreateCampaignDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.campaigns.create(tenantId, actorOf(user), body, String(idempotencyKey));
  }

  @ApiOperation({
    summary: 'Estimar el tamaño de una audiencia',
    description: 'Cuenta personas, con app con avisos y con correo verificado.',
  })
  @ApiBody({ schema: zodToApiSchema(estimateAudienceSchema) })
  @Post('audience/estimate')
  @HttpCode(HttpStatus.OK)
  @Roles(...READ_ROLES)
  estimate(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(estimateAudienceSchema)) body: EstimateAudienceDto) {
    return this.audience.estimate(tenantId, body);
  }

  @ApiOperation({ summary: 'Detalle de una campaña con métricas por canal' })
  @Get(':campaignId')
  @Roles(...READ_ROLES)
  get(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string }) {
    return this.campaigns.get(tenantId, params.campaignId);
  }

  @ApiOperation({ summary: 'Avisos individuales generados por una campaña' })
  @Get(':campaignId/messages')
  @Roles(...READ_ROLES)
  messages(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string },
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: { page: number; limit: number; status?: string; channel?: string },
  ) {
    return this.campaigns.listMessages(tenantId, params.campaignId, query);
  }

  @ApiOperation({ summary: 'Editar una campaña en borrador o programada', description: 'Editar una programada la devuelve a borrador.' })
  @ApiBody({ schema: zodToApiSchema(updateCampaignSchema) })
  @Patch(':campaignId')
  @Roles(...WRITE_ROLES)
  update(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string },
    @Body(new ZodValidationPipe(updateCampaignSchema)) body: UpdateCampaignDto,
  ) {
    return this.campaigns.update(tenantId, params.campaignId, body);
  }

  @ApiOperation({ summary: 'Programar la campaña', description: 'Congela la audiencia y exige que no esté vacía.' })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @Post(':campaignId/schedule')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  schedule(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string },
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.campaigns.schedule(tenantId, params.campaignId, actorOf(user));
  }

  @ApiOperation({ summary: 'Devolver a borrador una campaña programada que aún no empezó' })
  @Post(':campaignId/unschedule')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  unschedule(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string }) {
    return this.campaigns.unschedule(tenantId, params.campaignId);
  }

  @ApiOperation({ summary: 'Pausar una campaña en curso' })
  @Post(':campaignId/pause')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  pause(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string }) {
    return this.campaigns.pause(tenantId, params.campaignId);
  }

  @ApiOperation({ summary: 'Reanudar una campaña pausada' })
  @Post(':campaignId/resume')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  resume(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string }) {
    return this.campaigns.resume(tenantId, params.campaignId);
  }

  @ApiOperation({ summary: 'Cancelar la campaña', description: 'Anula los avisos que aún no salieron; exige un motivo.' })
  @ApiBody({ schema: zodToApiSchema(cancelCampaignSchema) })
  @Post(':campaignId/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  cancel(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string },
    @Body(new ZodValidationPipe(cancelCampaignSchema)) body: CancelCampaignDto,
  ) {
    return this.campaigns.cancel(tenantId, params.campaignId, body);
  }

  @ApiOperation({ summary: 'Duplicar una campaña como borrador nuevo' })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @Post(':campaignId/duplicate')
  @Roles(...WRITE_ROLES)
  duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string },
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.campaigns.duplicate(tenantId, params.campaignId, actorOf(user), String(idempotencyKey));
  }

  @ApiOperation({
    summary: 'Enviar la campaña de prueba a un cliente',
    description: 'Entrega en el acto y devuelve el resultado por canal.',
  })
  @ApiBody({ schema: zodToApiSchema(testSendCampaignSchema) })
  @Post(':campaignId/test-send')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  sendTest(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(campaignIdParamsSchema)) params: { campaignId: string },
    @Body(new ZodValidationPipe(testSendCampaignSchema)) body: TestSendCampaignDto,
  ) {
    return this.testSend.send(tenantId, params.campaignId, body);
  }
}
