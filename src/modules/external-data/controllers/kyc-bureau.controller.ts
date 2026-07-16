import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../../common/utils/http/headers.util.js';
import { actorId, assertCustomerAccess } from '../external-data-controller.util.js';
import { ExternalDataService } from '../external-data.service.js';
import { infocenterCheckSchema, InfocenterCheckDto, segipVerifySchema, SegipVerifyDto } from '../external-data.schemas.js';

/**
 * Verticales de identidad y buró de crédito.
 *
 * Extraídos de `external-data.controller.ts` (Fase 2.2 del plan 10/10) sin cambios: rutas, guards,
 * roles y comportamiento idénticos. Ese archivo agrupaba 9 controllers en 966 líneas.
 */

@ApiTags('kyc')
@ApiBearerAuth('access-token')
@Controller('kyc')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class KycExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({
    summary: 'Verificar identidad contra SEGIP',
    description: 'Consulta el registro de identidad boliviano (SEGIP/CGIP) para validar documento, nombre, fecha de nacimiento.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(segipVerifySchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la verificación de identidad.' })
  @ApiResponse({ status: 403, description: 'Un customer intentó verificar la identidad de otro cliente.' })
  @Post('segip/verify')
  @HttpCode(HttpStatus.OK)
  verifySegip(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(segipVerifySchema)) body: SegipVerifyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeSegip({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }
}

@ApiTags('bureau')
@ApiBearerAuth('access-token')
@Controller('bureau')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class BureauExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({
    summary: 'Consultar buró de crédito InfoCenter',
    description:
      'Consulta el buró de crédito boliviano InfoCenter (proveedor costoso — sujeto a política de costo/aprobación manual). No incluye customer/internal_operator en roles: exclusivo de analistas/admin.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(infocenterCheckSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del buró de crédito.' })
  @ApiResponse({ status: 422, description: 'BLOCKED_BY_COST_POLICY o MANUAL_APPROVAL_REQUIRED según la política configurada.' })
  @Post('infocenter/check')
  @HttpCode(HttpStatus.OK)
  checkInfocenter(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(infocenterCheckSchema)) body: InfocenterCheckDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeInfocenter({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }
}
