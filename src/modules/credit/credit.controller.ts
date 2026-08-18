/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { CreditApplicationService } from './application/credit-application.service.js';
import { CreditProductService } from './application/credit-product.service.js';
import {
  CreateCreditApplicationDto,
  CreditCustomerIdParamsDto,
  createCreditApplicationSchema,
  creditCustomerIdParamsSchema,
} from './credit.schemas.js';

/**
 * Cara de cliente del dominio de crédito: qué productos hay y cómo se solicita uno.
 *
 * El endpoint de creación reevalúa la elegibilidad en el servidor antes de escribir nada. Ocultar el
 * botón en la app es experiencia de usuario; esa reevaluación es la garantía.
 */
@ApiTags('credit')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CreditController {
  constructor(
    private readonly productService: CreditProductService,
    private readonly applicationService: CreditApplicationService,
  ) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Productos crediticios disponibles',
    description:
      'Devuelve los productos vigentes del tenant junto con la elegibilidad del cliente y sus bloqueadores. ' +
      '`canApply` refleja la elegibilidad real, de modo que el catálogo y la puerta de entrada no puedan discrepar.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para `customer` (se toma del token).' })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(creditCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Catálogo de productos + elegibilidad del cliente.' })
  @Get('credit-products')
  listProducts(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(creditCustomerIdParamsSchema)) params: CreditCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.listForCustomer({ tenantId, customerId: params.customerId, currentUser });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Crear una solicitud de crédito',
    description:
      'Valida el producto, el monto y el plazo, REEVALÚA la elegibilidad del cliente en el servidor y, solo si resulta ' +
      'elegible, crea la solicitud guardando la evaluación que la autorizó. Un cliente no elegible recibe ' +
      '`422 CUSTOMER_NOT_ELIGIBLE` con la lista de bloqueadores y no se persiste ninguna solicitud.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(creditCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(createCreditApplicationSchema) })
  @ApiResponse({ status: 201, description: 'Solicitud creada.' })
  @ApiResponse({ status: 404, description: 'CREDIT_PRODUCT_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'CREDIT_APPLICATION_ALREADY_OPEN — el cliente ya tiene una solicitud viva.' })
  @ApiResponse({
    status: 422,
    description: 'CUSTOMER_NOT_ELIGIBLE, CREDIT_PRODUCT_NOT_AVAILABLE, REQUESTED_AMOUNT_OUT_OF_RANGE o REQUESTED_TERM_OUT_OF_RANGE.',
  })
  @Post('credit-applications')
  @HttpCode(HttpStatus.CREATED)
  createApplication(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(creditCustomerIdParamsSchema)) params: CreditCustomerIdParamsDto,
    @Body(new ZodValidationPipe(createCreditApplicationSchema)) body: CreateCreditApplicationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.applicationService.createApplication({
      tenantId: tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({ summary: 'Listar las solicitudes del cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(creditCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Solicitudes del cliente, más recientes primero.' })
  @Get('credit-applications')
  listApplications(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(creditCustomerIdParamsSchema)) params: CreditCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.applicationService.listApplications({ tenantId, customerId: params.customerId, currentUser });
  }
}
