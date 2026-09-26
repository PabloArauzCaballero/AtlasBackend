/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business La fase 4 del alta: seis preguntas de hábitos de consumo, una por pantalla.
 * @system catálogo, guardado parcial (PUT) y estado (GET) de la encuesta de hábitos del cliente.
 */
import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { OnboardingCustomerIdParamsDto, onboardingCustomerIdParamsSchema } from '../customer-onboarding.schemas.js';
import { ConsumerSurveyDto, consumerSurveySchema } from './consumer-survey.schemas.js';
import { ConsumerSurveyService } from './consumer-survey.service.js';

const CUSTOMER_AND_INTERNAL = ['customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin'] as const;

@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
@Controller('customer-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ConsumerSurveyController {
  constructor(private readonly service: ConsumerSurveyService) {}

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({ summary: 'Catálogo de la encuesta de hábitos (versión vigente)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Preguntas y opciones de `habitos-v1`.' })
  @Get('consumer-survey/catalog')
  catalog() {
    return this.service.catalog();
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({ summary: 'Estado de la encuesta de hábitos del cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Respuestas guardadas, preguntas que faltan y si está completa.' })
  @Get(':customerId/consumer-survey')
  status(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.status({ tenantId, customerId: params.customerId, currentUser });
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({ summary: 'Guardar respuestas de la encuesta de hábitos (parcial o completa)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: { type: 'string' } })
  @ApiBody({ schema: zodToApiSchema(consumerSurveySchema) })
  @ApiResponse({ status: 200, description: 'Estado tras guardar.' })
  @Put(':customerId/consumer-survey')
  save(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(consumerSurveySchema)) body: ConsumerSurveyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.save({ tenantId, customerId: params.customerId, body, currentUser });
  }
}
