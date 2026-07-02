import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { CustomerTelemetryService } from './customer-telemetry.service.js';
import {
  telemetryBatchSchema,
  TelemetryBatchDto,
  telemetryCustomerParamsSchema,
  TelemetryCustomerParamsDto,
} from './customer-telemetry.schemas.js';

type RequestWithIp = { ip?: string };

@ApiTags('customer-telemetry')
@Controller('customers/:customerId/telemetry')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class CustomerTelemetryController {
  constructor(private readonly telemetryService: CustomerTelemetryService) {}

  @Post('batch')
  @HttpCode(HttpStatus.ACCEPTED)
  ingestBatch(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(telemetryCustomerParamsSchema)) params: TelemetryCustomerParamsDto,
    @Body(new ZodValidationPipe(telemetryBatchSchema)) body: TelemetryBatchDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.telemetryService.ingestBatch({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey,
      ipAddress: request.ip ?? null,
    });
  }
}
