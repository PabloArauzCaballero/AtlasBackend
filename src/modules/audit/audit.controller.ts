import { Controller, Get, Headers, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { AuditService } from './audit.service.js';
import { auditCustomerParamsSchema, AuditCustomerParamsDto, auditQuerySchema, AuditQueryDto } from './audit.schemas.js';

@ApiTags('audit')
@Controller('operations/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('customer/:customerId')
  getCustomerAudit(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(auditCustomerParamsSchema)) params: AuditCustomerParamsDto,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQueryDto,
  ) {
    return this.service.getCustomerAudit(parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'), params, query);
  }
}
