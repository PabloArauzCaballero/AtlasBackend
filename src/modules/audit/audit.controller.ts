import { Controller, Get, Headers, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { AuditService } from './audit.service.js';
import {
  auditCustomerParamsSchema,
  AuditCustomerParamsDto,
  auditQuerySchema,
  AuditQueryDto,
  auditFeedQuerySchema,
  AuditFeedQueryDto,
} from './audit.schemas.js';

@ApiTags('audit')
@ApiBearerAuth('access-token')
@Controller('operations/audit')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @ApiOperation({
    summary: 'Historial de auditoría de un cliente (paginado por offset)',
    description: 'Combina 8 fuentes de eventos (status, auth, consent, manual_review, fraud, data_change, customer_action, operational_audit). eventType=risk no tiene fuente dedicada — se ve mezclado en operational_audit bajo actionCode risk_assessment.created.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(auditCustomerParamsSchema.shape.customerId) })
  @ApiQuery({ name: 'eventType', required: false, schema: zodObjectPropertySchemas(auditQuerySchema).eventType })
  @ApiQuery({ name: 'from', required: false, schema: zodObjectPropertySchemas(auditQuerySchema).from })
  @ApiQuery({ name: 'to', required: false, schema: zodObjectPropertySchemas(auditQuerySchema).to })
  @ApiResponse({ status: 200, description: 'Historial de auditoría paginado.' })
  @Get('customer/:customerId')
  getCustomerAudit(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(auditCustomerParamsSchema)) params: AuditCustomerParamsDto,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQueryDto,
  ) {
    return this.service.getCustomerAudit(parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'), params, query);
  }

  /**
   * ATLAS-P11-T10: variante por cursor real (vista `audit_event_feed`, ver la migración
   * `20260703035812-add-unified-audit-event-feed-view.ts`). Mantiene `GET .../customer/:id` sin
   * cambios por compatibilidad.
   */
  @ApiOperation({
    summary: 'Historial de auditoría de un cliente (paginado por cursor real)',
    description: 'Lee de la vista audit_event_feed (cubre las 8 fuentes con cursor SQL real, más eficiente que la variante offset para volúmenes altos).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(auditCustomerParamsSchema.shape.customerId) })
  @ApiQuery({ name: 'cursor', required: false, schema: zodObjectPropertySchemas(auditFeedQuerySchema).cursor })
  @ApiResponse({ status: 200, description: 'Página del feed de auditoría.' })
  @Get('customer/:customerId/feed')
  getCustomerAuditFeed(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(auditCustomerParamsSchema)) params: AuditCustomerParamsDto,
    @Query(new ZodValidationPipe(auditFeedQuerySchema)) query: AuditFeedQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.service.getCustomerAuditFeed(tenantId, params.customerId, query);
  }
}
