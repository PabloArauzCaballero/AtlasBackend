import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { CustomersService } from './customers.service.js';
import { customerIdParamsSchema, CustomerIdParamsDto } from './customers.schemas.js';

@ApiTags('customers')
@ApiBearerAuth('access-token')
@Controller('customers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // Antes de este fix, este endpoint no tenía `@Roles(...)` — a diferencia de TODOS sus
  // módulos hermanos (customer-privacy, customer-telemetry, sessions, risk,
  // customer-onboarding), que restringen explícitamente. Sin esta lista, `RolesGuard` dejaba
  // pasar cualquier rol autenticado (incluido `merchant` o `system`) y solo
  // `assertOwnCustomerResource` bloqueaba el caso `role === 'customer'` con id ajeno — un
  // `merchant`/`system` podía leer el perfil, contactos, consentimientos y riesgo de
  // CUALQUIER cliente del tenant sin ninguna restricción de autorización real.
  @Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Perfil resumido del cliente ("mi perfil")',
    description:
      'Devuelve el perfil vigente del cliente: datos de identidad, contactos, consentimientos otorgados y el último resultado de ' +
      'riesgo reducido (decisión + nivel, sin el desglose completo del modelo). Un `customer` solo puede leer su propio perfil ' +
      '(`assertOwnCustomerResource`); los roles internos listados pueden leer el de cualquier cliente del tenant.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para `customer` (se toma del token); requerido para roles internos.' })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId), description: 'Id numérico del cliente.' })
  @ApiResponse({ status: 200, description: 'Perfil del cliente.' })
  @ApiResponse({ status: 400, description: 'x-tenant-id ausente o no es un entero positivo válido.' })
  @ApiResponse({ status: 403, description: 'Un actor con rol customer intentó leer el perfil de otro cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Get(':customerId/me')
  getCustomerMe(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? currentUser.tenantId ?? ''), 'x-tenant-id');
    return this.customersService.getCustomerMe(tenantId, params.customerId, currentUser);
  }
}
