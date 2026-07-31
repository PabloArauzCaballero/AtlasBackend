/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { CreditDecisionService } from './application/credit-decision.service.js';
import { CreditProductService } from './application/credit-product.service.js';
import {
  CreateCreditProductDto,
  CreditApplicationDecisionDto,
  CreditProductIdParamsDto,
  CreditProductStatusDto,
  createCreditProductSchema,
  creditApplicationDecisionSchema,
  creditProductIdParamsSchema,
  creditProductStatusSchema,
} from './credit.schemas.js';

/**
 * Administración del catálogo crediticio y decisión sobre las solicitudes.
 *
 * El catálogo es dato de negocio: el backend impone estructura y coherencia de rangos, pero no
 * decide montos, plazos ni tasas. Por eso no hay ningún producto sembrado — inventar una tasa sería
 * inventar una decisión que no le corresponde al sistema.
 */
@ApiTags('credit')
@ApiBearerAuth('access-token')
@Controller('operations/credit')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class CreditOperationsController {
  constructor(
    private readonly productService: CreditProductService,
    private readonly decisionService: CreditDecisionService,
  ) {}

  @ApiOperation({ summary: 'Listar los productos vigentes (operaciones)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Productos del tenant.' })
  @Get('products')
  listProducts(@Headers('x-tenant-id') tenantIdHeader: string | undefined) {
    return this.productService.listForOperations(tenantIdFromHeader(tenantIdHeader));
  }

  @ApiOperation({
    summary: 'Crear un producto crediticio',
    description: 'El producto nace en `draft`: activarlo es una decisión aparte y auditable, no un efecto de haberlo creado.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(createCreditProductSchema) })
  @ApiResponse({ status: 201, description: 'Producto creado en estado `draft`.' })
  @ApiResponse({ status: 409, description: 'CREDIT_PRODUCT_CODE_ALREADY_EXISTS.' })
  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  createProduct(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(createCreditProductSchema)) body: CreateCreditProductDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.createProduct({ tenantId: tenantIdFromHeader(tenantIdHeader), body, currentUser });
  }

  @ApiOperation({ summary: 'Cambiar el estado de un producto (activar, suspender, retirar)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'productId', schema: zodToApiSchema(creditProductIdParamsSchema.shape.productId) })
  @ApiBody({ schema: zodToApiSchema(creditProductStatusSchema) })
  @ApiResponse({ status: 200, description: 'Estado actualizado.' })
  @ApiResponse({ status: 404, description: 'CREDIT_PRODUCT_NOT_FOUND.' })
  @Patch('products/:productId/status')
  @HttpCode(HttpStatus.OK)
  changeProductStatus(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(creditProductIdParamsSchema)) params: CreditProductIdParamsDto,
    @Body(new ZodValidationPipe(creditProductStatusSchema)) body: CreditProductStatusDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.changeStatus({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      productId: params.productId,
      status: body.status,
      currentUser,
    });
  }

  @ApiOperation({
    summary: 'Decidir una solicitud de crédito',
    description:
      'Aprueba, rechaza o pide más información. Estado e historial se escriben en la misma transacción; rechazar o pedir ' +
      'información exige nota. Una solicitud ya resuelta responde `409 CREDIT_APPLICATION_ALREADY_DECIDED`.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(creditApplicationDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión aplicada.' })
  @ApiResponse({ status: 404, description: 'CREDIT_APPLICATION_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'CREDIT_APPLICATION_ALREADY_DECIDED.' })
  @Post('applications/:applicationId/decision')
  @HttpCode(HttpStatus.OK)
  decideApplication(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('applicationId') applicationId: string,
    @Body(new ZodValidationPipe(creditApplicationDecisionSchema)) body: CreditApplicationDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.decisionService.decide({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      applicationId,
      body,
      currentUser,
    });
  }

  @ApiOperation({ summary: 'Detalle de una solicitud, con su historial completo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Solicitud + eventos, más recientes primero.' })
  @Get('applications/:applicationId')
  getApplicationDetail(@Headers('x-tenant-id') tenantIdHeader: string | undefined, @Param('applicationId') applicationId: string) {
    return this.decisionService.getApplicationDetail(tenantIdFromHeader(tenantIdHeader), applicationId);
  }
}
