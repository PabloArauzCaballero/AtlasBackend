/**
 * @file Adaptador HTTP: el expediente del alta de un cliente, para operaciones.
 * @business El equipo interno ve lo mismo que llega al caso del Motor: lo declarado frente al carnet, cómo se hizo el alta y qué dejó el teléfono.
 * @system sólo lectura, roles internos; mismo contrato que el anexo `onboarding-dossier` del Motor.
 */
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { OnboardingReviewDossierService } from './application/onboarding-review-dossier.service.js';
import { OnboardingCustomerIdParamsDto, onboardingCustomerIdParamsSchema } from './customer-onboarding.schemas.js';

@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
@Controller('operations/customers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class OnboardingReviewDossierController {
  constructor(private readonly dossiers: OnboardingReviewDossierService) {}

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Expediente del alta para revisar la identidad',
    description:
      'Lo declarado (con carnet, teléfono y correo enmascarados), lo leído del carnet frente a lo declarado y el registro ' +
      'estatal, el cronómetro y la bitácora del alta, el dispositivo, permisos, consentimientos, ubicación, agenda ' +
      'agregada y las evidencias. Un bloque sin dato es null. Es el mismo JSON que se anexa al caso del Motor.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Expediente del alta, versión 1.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Get(':customerId/review-dossier')
  get(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
  ) {
    return this.dossiers.build(tenantId, params.customerId);
  }
}
