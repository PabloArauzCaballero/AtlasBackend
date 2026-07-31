/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { CustomerComplianceScreeningService } from './application/customer-compliance-screening.service.js';
import { CustomerVerificationService } from './application/customer-verification.service.js';
import {
  ClearWatchlistMatchesDto,
  IdentityDecisionDto,
  clearWatchlistMatchesSchema,
  identityDecisionSchema,
} from './customer-onboarding-profile.schemas.js';
import { OnboardingCustomerIdParamsDto, onboardingCustomerIdParamsSchema } from './customer-onboarding.schemas.js';

/**
 * Resolución humana de identidad y cumplimiento.
 *
 * Estos tres endpoints desbloquean las condiciones C9, C10 y C13 de la regla de habilitación, que
 * hasta ahora ningún cliente podía satisfacer: la verificación de identidad y la revisión documental
 * se creaban en `pending_review` sin camino de salida, y el screening de listas no se ejecutaba nunca.
 */
@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
@Controller('operations/customers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerVerificationController {
  constructor(
    private readonly verificationService: CustomerVerificationService,
    private readonly screeningService: CustomerComplianceScreeningService,
  ) {}

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Resolver la verificación de identidad del cliente',
    description:
      'Aprueba o rechaza el expediente de identidad en bloque: el intento de verificación, el documento y todas sus ' +
      'evidencias pendientes. Aprobar NO habilita al cliente por sí solo — la habilitación sigue dependiendo de las quince ' +
      'condiciones de la regla, que se reevalúa y se registra en la misma transacción.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(identityDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión aplicada — incluye la elegibilidad resultante y sus bloqueadores.' })
  @ApiResponse({ status: 404, description: 'IDENTITY_VERIFICATION_ATTEMPT_NOT_FOUND o cliente inexistente.' })
  @Post(':customerId/identity-verification/decision')
  @HttpCode(HttpStatus.OK)
  decideIdentity(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(identityDecisionSchema)) body: IdentityDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.verificationService.decideIdentity({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles('compliance_analyst', 'risk_analyst', 'admin', 'platform_admin', 'system')
  @ApiOperation({
    summary: 'Ejecutar el screening de listas restrictivas',
    description:
      'Coteja por HASH el nombre normalizado y los contactos primarios del cliente contra las entradas vigentes de ' +
      '`watchlist_entries` (del tenant y globales). Una coincidencia nueva bloquea la habilitación y lleva al cliente a ' +
      '`under_review`. Es idempotente: reejecutarlo no duplica coincidencias ya registradas.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Resultado del screening y elegibilidad resultante.' })
  @Post(':customerId/compliance/screening')
  @HttpCode(HttpStatus.OK)
  screen(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.screeningService.screen({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId: params.customerId,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles('compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Descartar las coincidencias de listas restrictivas',
    description:
      'Cierra los falsos positivos de cumplimiento. Exige código de razón y nota: descartar una coincidencia sin motivo ' +
      'escrito es exactamente la decisión que después nadie puede defender. Exclusivo de cumplimiento y administración.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(clearWatchlistMatchesSchema) })
  @ApiResponse({ status: 200, description: 'Coincidencias descartadas y elegibilidad recalculada.' })
  @Post(':customerId/compliance/clear-matches')
  @HttpCode(HttpStatus.OK)
  clearMatches(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(clearWatchlistMatchesSchema)) body: ClearWatchlistMatchesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.screeningService.clearMatches({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId: params.customerId,
      reasonCode: body.reasonCode,
      notes: body.notes,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }
}
