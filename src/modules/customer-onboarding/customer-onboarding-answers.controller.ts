/**
 * @file Adaptador HTTP: devuelve lo que el cliente ya contestó en el alta.
 * @business Volver a un paso del alta enseña lo ya escrito en lugar de un formulario vacío.
 * @system sólo lectura; misma regla de propiedad que el resto del alta (el cliente sólo ve lo suyo).
 */
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CustomerOnboardingAnswersService } from './application/customer-onboarding-answers.service.js';
import { OnboardingCustomerIdParamsDto, onboardingCustomerIdParamsSchema } from './customer-onboarding.schemas.js';

const CUSTOMER_AND_INTERNAL = ['customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin'] as const;

@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
@Controller('customer-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerOnboardingAnswersController {
  constructor(private readonly answersService: CustomerOnboardingAnswersService) {}

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({
    summary: 'Respuestas ya guardadas del alta',
    description:
      'Devuelve lo vigente de datos personales, perfil económico y domicilio (con la calle descifrada y la última ' +
      'coordenada declarada) para que la app rellene cada paso al volver a él.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Respuestas vigentes; `null` en lo que todavía no se contestó.' })
  @Get(':customerId/answers')
  getAnswers(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.answersService.getAnswers({ tenantId, customerId: params.customerId, currentUser });
  }
}
