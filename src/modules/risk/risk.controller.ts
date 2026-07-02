import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { RiskService } from './risk.service.js';
import {
  createRiskAssessmentSchema,
  CreateRiskAssessmentDto,
  customerRiskParamsSchema,
  CustomerRiskParamsDto,
  riskAssessmentParamsSchema,
  RiskAssessmentParamsDto,
} from './risk.schemas.js';

@ApiTags('risk')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'system', 'admin', 'platform_admin')
  @Post('customers/:customerId/risk-assessments')
  @HttpCode(HttpStatus.CREATED)
  createRiskAssessment(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(customerRiskParamsSchema)) params: CustomerRiskParamsDto,
    @Body(new ZodValidationPipe(createRiskAssessmentSchema)) body: CreateRiskAssessmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.riskService.createRiskAssessment({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey,
    });
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
  @Get('operations/risk-assessments/:riskAssessmentRunId')
  getRiskAssessmentDetail(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(riskAssessmentParamsSchema)) params: RiskAssessmentParamsDto,
  ) {
    return this.riskService.getRiskAssessmentDetail(
      parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      params.riskAssessmentRunId,
    );
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
  @Get('operations/risk-assessments/:riskAssessmentRunId/explanation')
  getRiskAssessmentExplanation(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(riskAssessmentParamsSchema)) params: RiskAssessmentParamsDto,
  ) {
    return this.riskService.getRiskAssessmentExplanation(
      parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      params.riskAssessmentRunId,
    );
  }
}
