import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { OperationsService } from './operations.service.js';
import {
  listFraudCasesQuerySchema,
  ListFraudCasesQueryDto,
  listManualReviewCasesQuerySchema,
  ListManualReviewCasesQueryDto,
} from './operations.schemas.js';

@Controller('operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get('manual-review-cases')
  listManualReviewCases(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listManualReviewCasesQuerySchema)) query: ListManualReviewCasesQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.listManualReviewCases(tenantId, query);
  }

  @Get('fraud-cases')
  listFraudCases(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listFraudCasesQuerySchema)) query: ListFraudCasesQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.listFraudCases(tenantId, query);
  }
}
