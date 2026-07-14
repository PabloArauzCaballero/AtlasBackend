import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { CustomerTelemetryService } from './customer-telemetry.service.js';
import {
  telemetryBatchSchema,
  TelemetryBatchDto,
  telemetryCustomerParamsSchema,
  TelemetryCustomerParamsDto,
} from './customer-telemetry.schemas.js';

type RequestWithIp = { ip?: string };

@ApiTags('customer-telemetry')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId/telemetry')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class CustomerTelemetryController {
  constructor(private readonly telemetryService: CustomerTelemetryService) {}

  @ApiOperation({
    summary: 'Ingerir batch de telemetría del cliente',
    description:
      'Recibe hasta 100 eventos + 100 métricas on-device por batch (interacción de formulario, permisos, auth, riesgo de ' +
      'dispositivo, SIM, reputación de IP, pasos de onboarding, acciones del cliente). Rechaza el batch completo si detecta ' +
      'indicios de volcado de agenda de contactos cruda (`RAW_CONTACTS_NOT_ALLOWED`). Un `customer` solo puede reportar ' +
      'telemetría de un dispositivo/sesión vinculados a sí mismo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(telemetryCustomerParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(telemetryBatchSchema) })
  @ApiResponse({ status: 202, description: 'Batch aceptado — cantidad de eventos/métricas procesados.' })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente, batch vacío, o payload > 250 KB.' })
  @ApiResponse({ status: 403, description: 'El dispositivo o la sesión no pertenecen al cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'RAW_CONTACTS_NOT_ALLOWED — el batch contiene indicios de agenda de contactos cruda.' })
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
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey,
      ipAddress: request.ip ?? null,
    });
  }
}
