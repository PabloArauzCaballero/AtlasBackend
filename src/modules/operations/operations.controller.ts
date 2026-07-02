import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { FraudService } from '../fraud/fraud.service.js';
import { fraudDecisionParamsSchema, FraudDecisionParamsDto, fraudDecisionSchema, FraudDecisionDto } from '../fraud/fraud.schemas.js';
import { OperationsService } from './operations.service.js';
import {
  operationsCustomerIdParamsSchema,
  manualReviewDecisionParamsSchema,
  ManualReviewDecisionParamsDto,
  manualReviewDecisionSchema,
  ManualReviewDecisionDto,
  OperationsCustomerIdParamsDto,
  workQueueQuerySchema,
  WorkQueueQueryDto,
} from './operations.schemas.js';

@ApiTags('operations')
@Controller('operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class OperationsController {
  constructor(
    private readonly operationsService: OperationsService,
    private readonly fraudService: FraudService,
  ) {}

  @Get('work-queue')
  getWorkQueue(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(workQueueQuerySchema)) query: WorkQueueQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.getWorkQueue(tenantId, query);
  }

  @Get('customers/:customerId/investigation-summary')
  getInvestigationSummary(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(operationsCustomerIdParamsSchema)) params: OperationsCustomerIdParamsDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.getInvestigationSummary(tenantId, params);
  }

  @Post('manual-review-cases/:caseId/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  decideManualReviewCase(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(manualReviewDecisionParamsSchema)) params: ManualReviewDecisionParamsDto,
    @Body(new ZodValidationPipe(manualReviewDecisionSchema)) body: ManualReviewDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.decideManualReviewCase({ tenantId, params, body, currentUser, idempotencyKey });
  }

  /**
   * ATLAS-AUDIT-014 (cerrado en este patch): la ruta se mantiene sin cambios por compatibilidad
   * de API; la implementación ahora vive en `FraudService` (módulo `fraud`), no en
   * `OperationsService`.
   */
  @Post('fraud-cases/:caseId/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('fraud_analyst', 'admin', 'platform_admin')
  decideFraudCase(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(fraudDecisionParamsSchema)) params: FraudDecisionParamsDto,
    @Body(new ZodValidationPipe(fraudDecisionSchema)) body: FraudDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.fraudService.decideFraudCase({ tenantId, params, body, currentUser, idempotencyKey });
  }
}
