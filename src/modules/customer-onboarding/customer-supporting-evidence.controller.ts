/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Lo copiado de la competencia que sí sirve: QR de cobro sin monto, factura de servicio, audio de ocupación.
 * @system registra una evidencia de apoyo de la fase 3 ya subida por URL firmada; ninguna decide sola y las tres van a revisión humana.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
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
import { RequestWithNetwork } from '../../common/utils/http/headers.util.js';
import { CustomerSupportingEvidenceService } from './application/customer-supporting-evidence.service.js';
import { OnboardingCustomerIdParamsDto, onboardingCustomerIdParamsSchema } from './customer-onboarding.schemas.js';
import { SupportingEvidenceDto, supportingEvidenceSchema } from './customer-supporting-evidence.schemas.js';

/** Separado del controlador de perfil por el gate de tamaño (300 líneas): es un caso de uso propio. */
@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
@Controller('customer-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerSupportingEvidenceController {
  constructor(private readonly supportingEvidenceService: CustomerSupportingEvidenceService) {}

  @Roles('customer')
  @ApiOperation({ summary: 'Registrar una evidencia de apoyo (QR de cobro, factura, audio de ocupación)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: { type: 'string' } })
  @ApiBody({ schema: zodToApiSchema(supportingEvidenceSchema) })
  @ApiResponse({ status: 201, description: 'Evidencia registrada y pendiente de revisión.' })
  @Post(':customerId/supporting-evidence')
  @HttpCode(HttpStatus.CREATED)
  registerSupportingEvidence(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(supportingEvidenceSchema)) body: SupportingEvidenceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.supportingEvidenceService.register({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }
}
