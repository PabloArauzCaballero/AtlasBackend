/**
 * @file Segmentos de audiencia guardados para campañas.
 * @business «Clientes con cuota vencida en El Alto» se define una vez y se reutiliza en cada campaña de
 *   cobranza, con su tamaño recalculado cada vez que se edita.
 * @system Mismos roles que las campañas: leer `internal_operator`+, escribir `admin`/`platform_admin`.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { NotificationCampaignAudienceService } from './notification-campaign-audience.service.js';
import { actorOf } from './notification-campaigns.controller.js';
import {
  createSegmentSchema,
  listSegmentsQuerySchema,
  segmentIdParamsSchema,
  updateSegmentSchema,
  type CreateSegmentDto,
  type UpdateSegmentDto,
} from './notification-campaigns.schemas.js';

@ApiTags('notification-campaigns')
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'x-tenant-id', required: true })
@Controller('operations/notifications/audience-segments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NotificationAudienceSegmentsController {
  constructor(private readonly audience: NotificationCampaignAudienceService) {}

  @ApiOperation({ summary: 'Listar segmentos de audiencia guardados' })
  @Get()
  @Roles('internal_operator', 'admin', 'platform_admin', 'system')
  list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listSegmentsQuerySchema)) query: { status: string }) {
    return this.audience.listSegments(tenantId, query.status);
  }

  @ApiOperation({ summary: 'Guardar un segmento de audiencia', description: 'Calcula su tamaño al guardarlo.' })
  @ApiBody({ schema: zodToApiSchema(createSegmentSchema) })
  @Post()
  @Roles('admin', 'platform_admin')
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body(new ZodValidationPipe(createSegmentSchema)) body: CreateSegmentDto,
  ) {
    return this.audience.createSegment(tenantId, actorOf(user), body);
  }

  @ApiOperation({ summary: 'Editar o archivar un segmento de audiencia' })
  @ApiBody({ schema: zodToApiSchema(updateSegmentSchema) })
  @Patch(':segmentId')
  @Roles('admin', 'platform_admin')
  update(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(segmentIdParamsSchema)) params: { segmentId: string },
    @Body(new ZodValidationPipe(updateSegmentSchema)) body: UpdateSegmentDto,
  ) {
    return this.audience.updateSegment(tenantId, params.segmentId, body);
  }
}
