/**
 * @file Los PAQUETES que el cliente entrega durante el alta: identidad, domicilio y contactos.
 * @business Cada paquete es evidencia que después sostiene una decisión de riesgo.
 * @system recibe los tres envíos de evidencia del alta, cada uno con su idempotencia.
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { IdentityManualReviewOutcomeService } from './application/identity-manual-review-outcome.service.js';
import { CustomerContactsSnapshotService } from './application/customer-contacts-snapshot.service.js';
import { contactsSnapshotSchema, ContactsSnapshotDto } from './customer-contacts-snapshot.schemas.js';
import { CustomerOnboardingService } from './customer-onboarding.service.js';
import {
  addressPackageSchema,
  AddressPackageDto,
  identityPackageSchema,
  IdentityPackageDto,
  onboardingCustomerIdParamsSchema,
  OnboardingCustomerIdParamsDto,
} from './customer-onboarding.schemas.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';

type RequestWithIp = {
  ip?: string;
};

/**
 * Salen de `CustomerOnboardingController` porque son los tres envíos de EVIDENCIA, frente al resto
 * del archivo, que es el arranque del alta y la verificación de contacto. Juntos pasaban de las 300
 * líneas de `check:file-size`.
 */
@ApiTags('customer-onboarding')
@Controller('customer-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerPackagesController {
  constructor(
    private readonly customerOnboardingService: CustomerOnboardingService,
    private readonly identityManualReviewOutcomeService: IdentityManualReviewOutcomeService,
    private readonly contactsSnapshotService: CustomerContactsSnapshotService,
  ) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Entrega el paquete de identidad del cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(identityPackageSchema) })
  @ApiResponse({ status: 202, description: 'Paquete de identidad recibido y encolado para procesamiento.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'CUSTOMER_BLOCKED, REQUIRED_EVIDENCE_MISSING, o REQUIRED_CONSENT_MISSING.' })
  @Post(':customerId/identity-package')
  @HttpCode(HttpStatus.ACCEPTED)
  submitIdentityPackage(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(identityPackageSchema)) body: IdentityPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    return this.customerOnboardingService.submitIdentityPackage({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  /*
   * El snapshot de la AGENDA, calculado en el teléfono.
   *
   * Va en el módulo de alta y no en telemetría porque forma parte del expediente
   * que decide si alguien entra: es una señal de alta, no una métrica de
   * producto. Y va DESPUÉS de las referencias en el recorrido de la app, porque
   * el número que más informa —cuántas de las referencias declaradas están en la
   * agenda— sólo se puede calcular cuando ya se declararon.
   *
   * Tres por minuto: es una operación que se hace UNA vez por alta, y un cliente
   * que la repita más que eso está reintentando en bucle o probando valores.
   */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Enviar el snapshot agregado de la agenda del teléfono',
    description:
      'Recibe CUENTAS y PROPORCIONES calculadas en el dispositivo —nunca nombres, teléfonos ni identificadores de contacto— más una ' +
      'lista opcional de hashes de un solo uso que el servidor cruza contra su propia lista de vigilancia y contra las referencias ' +
      'de otros expedientes. Los hashes NO se persisten: se usan en el cruce y se descartan antes de responder. Negar el permiso es ' +
      'una respuesta válida y se registra como tal.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(contactsSnapshotSchema) })
  @ApiResponse({ status: 202, description: 'Snapshot recibido. No devuelve análisis: el análisis lo hace el artefacto.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 400, description: 'El snapshot es incoherente consigo mismo (medidas sin permiso, cuentas imposibles).' })
  @Post(':customerId/contacts-snapshot')
  @HttpCode(HttpStatus.ACCEPTED)
  submitContactsSnapshot(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(contactsSnapshotSchema)) body: ContactsSnapshotDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    return this.contactsSnapshotService.submit({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Entrega el paquete de domicilio del cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(addressPackageSchema) })
  @ApiResponse({ status: 200, description: 'Paquete de domicilio registrado.' })
  @Post(':customerId/address-package')
  @HttpCode(HttpStatus.OK)
  submitAddressPackage(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(addressPackageSchema)) body: AddressPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    return this.customerOnboardingService.submitAddressPackage({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }
}
