/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, requireIdempotencyKey, tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { OnboardingAbandonmentService } from './application/onboarding-abandonment.service.js';
import { CustomerOnboardingStatusService } from './application/customer-onboarding-status.service.js';
import {
  MarkAbandonedFlowsDto,
  SubmitOnboardingDto,
  markAbandonedFlowsSchema,
  submitOnboardingSchema,
} from './customer-onboarding-profile.schemas.js';
import { OnboardingCustomerIdParamsDto, onboardingCustomerIdParamsSchema } from './customer-onboarding.schemas.js';

/**
 * Avance, envío y observaciones del onboarding.
 *
 * Estos tres endpoints son los que hacen posible reanudar el proceso. Antes no existía ninguno: un
 * cliente que cerraba la app no tenía a dónde volver, y uno observado por un analista no tenía forma
 * de enterarse de qué le estaban pidiendo.
 */
@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
@Controller('customer-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerOnboardingStatusController {
  constructor(
    private readonly statusService: CustomerOnboardingStatusService,
    private readonly abandonmentService: OnboardingAbandonmentService,
  ) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Estado y avance del onboarding',
    description:
      'Devuelve el estado del cliente, el flujo vigente, el porcentaje de avance calculado en el SERVIDOR, el estado de cada ' +
      'sección con sus campos faltantes, los bloqueadores de habilitación y el `nextStep`. Es el endpoint que el frontend ' +
      'consulta al abrir la app para saber dónde retomar. El porcentaje no se calcula en el cliente a propósito: dos versiones ' +
      'de la app mostrarían avances distintos con los mismos datos.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Estado, secciones, porcentaje de avance y próximo paso.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Get(':customerId/status')
  getStatus(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.statusService.getStatus({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId: params.customerId,
      currentUser,
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Enviar el paquete de onboarding a revisión',
    description:
      'Verifica que TODAS las secciones obligatorias estén completas, mueve al cliente a `under_review`, cierra el flujo de ' +
      'onboarding (`completion_status = completed`, `completed_at`) y dispara una evaluación de habilitación que puede ' +
      'promoverlo a `active`. Es el único punto del flujo donde se valida completitud.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(submitOnboardingSchema) })
  @ApiResponse({ status: 200, description: 'Paquete enviado — estado resultante, elegibilidad y bloqueadores vigentes.' })
  @ApiResponse({ status: 422, description: 'ONBOARDING_INCOMPLETE (con las secciones pendientes) o ONBOARDING_ALREADY_SUBMITTED.' })
  @Post(':customerId/submit')
  @HttpCode(HttpStatus.OK)
  submitForReview(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(submitOnboardingSchema)) _body: SubmitOnboardingDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.statusService.submitForReview({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId: params.customerId,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Observaciones abiertas del cliente',
    description:
      'Lista lo que el cliente debe corregir para avanzar. NO expone las notas internas del analista, que pueden contener ' +
      'criterio de riesgo reservado.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Observaciones, casos abiertos y bloqueadores vigentes.' })
  @Get(':customerId/observations')
  listObservations(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.statusService.listObservations({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId: params.customerId,
      currentUser,
    });
  }

  @Roles('admin', 'platform_admin', 'system')
  @ApiOperation({
    summary: 'Marcar como abandonados los onboardings inactivos (job)',
    description:
      'Cierra con `completion_status = abandoned` los flujos sin terminar cuya última actividad supera el umbral. Marca el ' +
      'FLUJO, no al cliente: quien dejó el registro a medias puede volver y retomar. Sin este cierre no existe tasa de abandono.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(markAbandonedFlowsSchema) })
  @ApiResponse({ status: 200, description: 'Cantidad evaluada y marcada, con la fecha de corte aplicada.' })
  @Post('jobs/mark-abandoned')
  @HttpCode(HttpStatus.OK)
  markAbandoned(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(markAbandonedFlowsSchema)) body: MarkAbandonedFlowsDto,
  ) {
    return this.abandonmentService.markAbandonedFlows({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      olderThanDays: body.olderThanDays,
      limit: body.limit,
    });
  }
}
