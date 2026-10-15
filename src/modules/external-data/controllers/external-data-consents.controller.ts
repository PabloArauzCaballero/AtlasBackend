/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertCustomerAccess, customerScopeForConsentMutation } from '../external-data-controller.util.js';
import { ExternalConsentService } from '../application/external-consent.service.js';
import {
  consentIdParamsSchema,
  ConsentIdParamsDto,
  customerIdParamsSchema,
  CustomerIdParamsDto,
  externalConsentSchema,
  ExternalConsentDto,
} from '../external-data.schemas.js';

/**
 * Consentimientos del cliente para consultas a proveedores externos.
 * Los `operationId` conservan el nombre del controller original (`ExternalDataController`): son contrato público (SDK
 * generados) y no cambian al partir el controller por subrecurso.
 */
@ApiTags('external-data')
@ApiBearerAuth('access-token')
@Controller('external-data')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class ExternalDataConsentsController {
  constructor(private readonly consent: ExternalConsentService) {}

  @ApiOperation({
    operationId: 'ExternalDataController_createConsent',
    summary: 'Registrar consentimiento para un proveedor externo',
    description:
      'Registra el consentimiento OTORGADO del cliente para consultar un proveedor de datos externos (KYC, buró, telco, etc.). ' +
      '`accepted` sólo admite `true`: una negativa no crea fila (400). No guarda versión del texto legal ni documento de consentimiento.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(externalConsentSchema) })
  @ApiResponse({ status: 201, description: 'Consentimiento registrado.' })
  @ApiResponse({ status: 403, description: 'Un customer intentó registrar consentimiento para otro cliente.' })
  @Post('consents')
  @HttpCode(HttpStatus.CREATED)
  createConsent(
    @CurrentTenant() tenantId: string,
    @Headers('x-forwarded-for') ipAddress: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Body(new ZodValidationPipe(externalConsentSchema)) body: ExternalConsentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.consent.createConsent({
      tenantId: tenantId,
      body,
      ipAddress,
      userAgent,
      // Personal interno registrando en nombre del cliente: la fila debe poder distinguirse de la del titular.
      assistedByUserId:
        currentUser.role === 'customer' ? undefined : (currentUser.internalUserId ?? currentUser.platformUserId ?? currentUser.sub),
    });
  }

  @ApiOperation({
    operationId: 'ExternalDataController_listConsents',
    summary: 'Listar consentimientos de proveedores externos de un cliente',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Lista de consentimientos.' })
  @Get('consents/user/:customerId')
  listConsents(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.consent.listCustomerConsents({
      tenantId: tenantId,
      customerId: params.customerId,
    });
  }

  @ApiOperation({ operationId: 'ExternalDataController_revokeConsent', summary: 'Revocar consentimiento de proveedor externo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'consentId', schema: zodToApiSchema(consentIdParamsSchema.shape.consentId) })
  @ApiResponse({ status: 200, description: 'Consentimiento revocado.' })
  @ApiResponse({ status: 404, description: 'Consentimiento no encontrado.' })
  @Post('consents/:consentId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeConsent(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(consentIdParamsSchema)) params: ConsentIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.consent.revokeConsent({
      tenantId: tenantId,
      consentId: params.consentId,
      customerId: customerScopeForConsentMutation(currentUser),
    });
  }
}
