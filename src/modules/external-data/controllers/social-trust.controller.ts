import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../../common/utils/http/headers.util.js';
import { actorId, assertCustomerAccess } from '../external-data-controller.util.js';
import { ExternalDataService } from '../external-data.service.js';
import {
  customerIdParamsSchema,
  CustomerIdParamsDto,
  digitalTrustCheckSchema,
  DigitalTrustCheckDto,
  facebookCallbackSchema,
  FacebookCallbackDto,
  facebookConnectUrlQuerySchema,
  FacebookConnectUrlQueryDto,
  whatsappVerificationConfirmSchema,
  WhatsappVerificationConfirmDto,
  whatsappVerificationStartSchema,
  WhatsappVerificationStartDto,
} from '../external-data.schemas.js';

/**
 * Verticales de señales sociales y confianza digital (Facebook, WhatsApp, digital trust).
 *
 * Extraídos de `external-data.controller.ts` (Fase 2.2 del plan 10/10) sin cambios: rutas, guards,
 * roles y comportamiento idénticos.
 */

@ApiTags('social')
@ApiBearerAuth('access-token')
@Controller('social/facebook')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin', 'system')
export class FacebookExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({ summary: 'Generar URL de conexión OAuth con Facebook' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'customerId', schema: zodObjectPropertySchemas(facebookConnectUrlQuerySchema).customerId })
  @ApiResponse({ status: 200, description: 'URL de conexión OAuth.' })
  @Get('connect-url')
  getConnectUrl(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(facebookConnectUrlQuerySchema)) query: FacebookConnectUrlQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, query.customerId);
    return this.externalDataService.createFacebookConnectUrl({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: query.customerId,
    });
  }

  @ApiOperation({
    summary: 'Callback OAuth de Facebook',
    description: 'Procesa el código de autorización devuelto por Facebook tras el consentimiento del usuario.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(facebookCallbackSchema) })
  @ApiResponse({ status: 200, description: 'Cuenta de Facebook conectada y datos de confianza social obtenidos.' })
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  callback(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(facebookCallbackSchema)) body: FacebookCallbackDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeFacebookCallback({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({ summary: 'Estado de conexión/verificación de Facebook de un cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Features derivados de la conexión Facebook.' })
  @Get('status/:customerId')
  status(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}

@ApiTags('whatsapp')
@ApiBearerAuth('access-token')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin', 'system')
export class WhatsappExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({
    summary: 'Iniciar verificación de WhatsApp',
    description: 'Envía un mensaje/código de verificación al número de WhatsApp del cliente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(whatsappVerificationStartSchema) })
  @ApiResponse({ status: 200, description: 'Verificación iniciada.' })
  @Post('verification/start')
  @HttpCode(HttpStatus.OK)
  start(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(whatsappVerificationStartSchema)) body: WhatsappVerificationStartDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeWhatsapp({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({
    summary: 'Confirmar verificación de WhatsApp',
    description: 'Valida el código recibido para completar la verificación del número de WhatsApp.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(whatsappVerificationConfirmSchema) })
  @ApiResponse({ status: 200, description: 'Verificación confirmada.' })
  @Post('verification/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(whatsappVerificationConfirmSchema)) body: WhatsappVerificationConfirmDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeWhatsapp({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({ summary: 'Estado de verificación de WhatsApp de un cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Features derivados de la verificación de WhatsApp.' })
  @Get('status/:customerId')
  status(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}

@ApiTags('digital-trust')
@ApiBearerAuth('access-token')
@Controller('digital-trust')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class DigitalTrustExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({
    summary: 'Consultar confianza digital (email/IP/dispositivo)',
    description: 'Consulta el proveedor de reputación digital genérico (identidad sintética, señales de email/IP/dispositivo).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(digitalTrustCheckSchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la consulta de confianza digital.' })
  @Post('check')
  @HttpCode(HttpStatus.OK)
  check(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(digitalTrustCheckSchema)) body: DigitalTrustCheckDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeDigitalTrust({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({ summary: 'Perfil de confianza digital de un cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Features de confianza digital.' })
  @Get('profile/:customerId')
  profile(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}
