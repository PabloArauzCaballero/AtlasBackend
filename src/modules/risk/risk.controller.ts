import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { RiskService } from './risk.service.js';
import { riskCustomerIdParamsSchema, RiskCustomerIdParamsDto } from './risk.schemas.js';

@Controller('customers/:customerId/risk')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Get('latest')
  getLatestRiskResult(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(riskCustomerIdParamsSchema)) params: RiskCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? currentUser.tenantId ?? ''), 'x-tenant-id');
    return this.riskService.getLatestCustomerRiskResult({ tenantId, customerId: params.customerId, currentUser });
  }
}
