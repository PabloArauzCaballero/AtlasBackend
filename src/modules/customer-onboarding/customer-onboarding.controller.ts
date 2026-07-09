import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { CustomerOnboardingService } from './customer-onboarding.service.js';
import {
  addressPackageSchema,
  AddressPackageDto,
  contactVerificationRequestSchema,
  ContactVerificationRequestDto,
  contactVerificationSubmitSchema,
  ContactVerificationSubmitDto,
  identityPackageSchema,
  IdentityPackageDto,
  onboardingCustomerIdParamsSchema,
  OnboardingCustomerIdParamsDto,
  startOnboardingSchema,
  StartOnboardingDto,
} from './customer-onboarding.schemas.js';

type RequestWithIp = {
  ip?: string;
};

function requireIdempotencyKey(idempotencyKey: string | undefined): string {
  if (!idempotencyKey) {
    throw new BadRequestException('X-Idempotency-Key header is required.');
  }
  return idempotencyKey;
}

@ApiTags('customer-onboarding')
@Controller('customer-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerOnboardingController {
  constructor(private readonly customerOnboardingService: CustomerOnboardingService) {}

  // 10 onboarding attempts per minute per IP — prevents enumeration and abuse
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Public()
  @ApiOperation({
    summary: 'Iniciar onboarding de un cliente nuevo',
    description:
      'Crea el registro de cliente, sus credenciales (si se envió contraseña) y registra los consentimientos iniciales requeridos, ' +
      'todo en una única transacción. Endpoint público (sin token) — limitado a 10 intentos por minuto por IP para prevenir ' +
      'enumeración/abuso. Requiere consentimientos otorgados (`REQUIRED_CONSENT_MISSING` si falta alguno obligatorio).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant en el que se registra el cliente.' })
  @ApiHeader({ name: 'x-idempotency-key', required: true, description: 'Evita crear el mismo cliente dos veces ante un reintento.' })
  @ApiBody({ schema: zodToApiSchema(startOnboardingSchema) })
  @ApiResponse({ status: 201, description: 'Cliente creado — devuelve el id del cliente y el estado inicial de onboarding.' })
  @ApiResponse({ status: 400, description: 'x-tenant-id/x-idempotency-key ausente, o body inválido.' })
  @ApiResponse({ status: 409, description: 'CUSTOMER_ALREADY_EXISTS — ya existe un cliente con el mismo teléfono/email en este tenant.' })
  @ApiResponse({ status: 422, description: 'REQUIRED_CONSENT_MISSING — falta otorgar un consentimiento obligatorio.' })
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  startOnboarding(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-client-channel') _channel: string | undefined,
    @Body(new ZodValidationPipe(startOnboardingSchema)) body: StartOnboardingDto,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.startOnboarding(tenantId, body, request.ip ?? null, requireIdempotencyKey(idempotencyKey));
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Solicitar código de verificación de contacto (OTP)',
    description: 'Envía un código de verificación (SMS/email, según el contacto) al método de contacto indicado del cliente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(contactVerificationRequestSchema) })
  @ApiResponse({ status: 202, description: 'Código de verificación enviado.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 409, description: 'VERIFICATION_RATE_LIMITED — demasiados intentos recientes para este contacto.' })
  @ApiResponse({ status: 422, description: 'CONTACT_NOT_REGISTERED — el contacto indicado no está registrado para este cliente.' })
  @Post(':customerId/contact-verification/request')
  @HttpCode(HttpStatus.ACCEPTED)
  requestContactVerification(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(contactVerificationRequestSchema)) body: ContactVerificationRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.requestContactVerification({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Confirmar código de verificación de contacto (OTP)',
    description: 'Valida el código recibido por SMS/email contra el intento de verificación pendiente más reciente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(contactVerificationSubmitSchema) })
  @ApiResponse({ status: 200, description: 'Contacto verificado correctamente.' })
  @ApiResponse({ status: 401, description: 'INVALID_VERIFICATION_CODE o VERIFICATION_CODE_EXPIRED.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente.' })
  @ApiResponse({ status: 404, description: 'VERIFICATION_ATTEMPT_NOT_FOUND — no hay un intento de verificación pendiente.' })
  @ApiResponse({ status: 409, description: 'CONTACT_ALREADY_VERIFIED — el contacto ya estaba verificado.' })
  @Post(':customerId/contact-verification/submit')
  @HttpCode(HttpStatus.OK)
  submitContactVerification(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(contactVerificationSubmitSchema)) body: ContactVerificationSubmitDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.submitContactVerification({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Enviar paquete de identidad (documentos + selfie)',
    description: 'Registra los documentos de identidad y evidencia biométrica del cliente para su revisión/scoring de riesgo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(identityPackageSchema) })
  @ApiResponse({ status: 202, description: 'Paquete de identidad recibido y encolado para procesamiento.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'CUSTOMER_BLOCKED, REQUIRED_EVIDENCE_MISSING, o REQUIRED_CONSENT_MISSING.' })
  @Post(':customerId/identity-package')
  @HttpCode(HttpStatus.ACCEPTED)
  submitIdentityPackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(identityPackageSchema)) body: IdentityPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.submitIdentityPackage({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Enviar paquete de dirección',
    description: 'Registra la dirección declarada del cliente (y evidencia GPS/geolocalización cuando corresponda).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(addressPackageSchema) })
  @ApiResponse({ status: 200, description: 'Paquete de dirección registrado.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'CUSTOMER_BLOCKED o REQUIRED_EVIDENCE_MISSING.' })
  @Post(':customerId/address-package')
  @HttpCode(HttpStatus.OK)
  submitAddressPackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(addressPackageSchema)) body: AddressPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
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
