/**
 * @file Adaptador HTTP: probar que el correo declarado por el comercio es suyo.
 * @business Sin un contacto probado no hay a quién avisar de la decisión, ni forma de recuperar el acceso.
 * @system dos rutas con su propio límite de intentos, separadas del resto del expediente.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PartnerContactVerificationService } from './application/partner-contact-verification.service.js';
import { PartnerOwnershipGuard } from './partner-ownership.guard.js';
import {
  ContactVerificationSubmitDto,
  contactVerificationSubmitSchema,
  PartnerIdParamsDto,
  partnerIdParamsSchema,
} from './partner-onboarding.schemas.js';

/**
 * La verificación del contacto, aparte del resto del expediente.
 *
 * Son dos rutas y llevan su propio `@Throttle`: pedir un código es lo único de este módulo que
 * dispara un correo, así que su techo de intentos no tiene nada que ver con el del resto. Estaban
 * dentro de `PartnerOnboardingController`, que con ellas pasaba de las 300 líneas del gate; y ahí
 * el límite se leía como si fuera del expediente entero.
 *
 * Mismo prefijo de ruta y mismos guards: para quien llama no cambia nada.
 */
@ApiTags('partner-onboarding')
@Controller('partner-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PartnerOwnershipGuard)
export class PartnerContactVerificationController {
  constructor(private readonly contact: PartnerContactVerificationService) {}

  /**
   * Pide el código que prueba el contacto.
   *
   * Se manda al correo QUE ESTÁ EN EL EXPEDIENTE, nunca a uno que venga en la petición: si el
   * destino viajara en el cuerpo, esto no probaría nada — cualquiera pediría el código a su buzón.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Enviar el código de verificación al correo del comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiResponse({ status: 202, description: 'Código enviado.' })
  @ApiResponse({ status: 409, description: 'PARTNER_VERIFICATION_RATE_LIMITED | PARTNER_CONTACT_ALREADY_VERIFIED.' })
  @ApiResponse({ status: 422, description: 'MAIL_CHANNEL_NOT_AVAILABLE.' })
  @Post(':partnerId/contact-verification/request')
  @HttpCode(HttpStatus.ACCEPTED)
  requestContactVerification(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
  ) {
    return this.contact.request(tenantId, params.partnerId);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Comprobar el código y dar por probado el contacto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(contactVerificationSubmitSchema) })
  @ApiResponse({ status: 200, description: 'Contacto verificado.' })
  @ApiResponse({ status: 401, description: 'Código inválido, vencido o con intentos agotados.' })
  @Post(':partnerId/contact-verification/submit')
  @HttpCode(HttpStatus.OK)
  submitContactVerification(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(contactVerificationSubmitSchema)) body: ContactVerificationSubmitDto,
  ) {
    return this.contact.submit(tenantId, params.partnerId, body.code);
  }
}
