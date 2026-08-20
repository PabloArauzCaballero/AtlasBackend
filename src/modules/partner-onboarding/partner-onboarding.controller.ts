/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system expone el alta del expediente, su estado y su envío a revisión.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { PartnerCommerceService } from './application/partner-commerce.service.js';
import { PartnerContactVerificationService } from './application/partner-contact-verification.service.js';
import { PartnerProfileService } from './application/partner-profile.service.js';
import { PartnerQrService } from './application/partner-qr.service.js';
import {
  toPartnerBranchDto,
  toPartnerPosTerminalDto,
  toPartnerProfileDto,
  toPartnerQrDto,
  toPartnerRepresentativeDto,
} from './partner-onboarding.mapper.js';
import {
  commercialRegistrySchema,
  ContactVerificationSubmitDto,
  contactVerificationSubmitSchema,
  CommercialRegistryDto,
  LegalRepresentativeDto,
  legalRepresentativeSchema,
  PartnerIdParamsDto,
  partnerIdParamsSchema,
  StartPartnerOnboardingDto,
  startPartnerOnboardingSchema,
} from './partner-onboarding.schemas.js';

/**
 * El expediente del comercio.
 *
 * Lo abre y lo completa el propio comercio (`merchant`) o el personal que lo acompaña; **la
 * decisión final no está aquí**: `submit` deja el caso en revisión y nadie lo aprueba desde este
 * controlador. Un onboarding que se auto-aprueba al completar sus campos es un formulario, no una
 * verificación.
 */
@ApiTags('partner-onboarding')
@Controller('partner-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PartnerOnboardingController {
  constructor(
    private readonly profiles: PartnerProfileService,
    private readonly commerce: PartnerCommerceService,
    private readonly qr: PartnerQrService,
    private readonly contact: PartnerContactVerificationService,
  ) {}

  // Diez altas por minuto y por IP: abrir expedientes en masa es la forma barata de sondear qué
  // NIT ya están registrados, porque el conflicto los delata.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Abrir el expediente de un comercio',
    description:
      'Crea el expediente verificable del partner. Rechaza con 409 si el NIT ya tiene expediente, ' +
      'devolviendo su identificador para poder continuarlo en vez de abrir un duplicado.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(startPartnerOnboardingSchema) })
  @ApiResponse({ status: 201, description: 'Expediente abierto.' })
  @ApiResponse({ status: 409, description: 'PARTNER_TAX_ID_ALREADY_REGISTERED.' })
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  async start(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(startPartnerOnboardingSchema)) body: StartPartnerOnboardingDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    return toPartnerProfileDto(await this.profiles.start(tenantId, body));
  }

  /**
   * El estado del expediente **con lo que le falta**.
   *
   * `gaps` viaja siempre y no sólo al fallar un envío: quien está completando el trámite necesita
   * saber cuánto le queda mientras lo hace, y descubrirlo sólo al pulsar «enviar» convierte el
   * proceso en una sucesión de intentos rechazados.
   */
  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Estado del expediente y lo que falta para enviarlo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiResponse({ status: 200, description: 'Estado, requisitos pendientes, sucursales, QR y terminales.' })
  @ApiResponse({ status: 404, description: 'Expediente no encontrado.' })
  @Get(':partnerId/status')
  async status(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const profile = await this.profiles.requireProfile(tenantId, params.partnerId);
    const [gaps, branches, qrCodes, terminals] = await Promise.all([
      this.profiles.findSubmissionGaps(tenantId, profile),
      this.commerce.listBranches(tenantId, params.partnerId),
      this.qr.list(tenantId, params.partnerId),
      this.commerce.listPosTerminals(tenantId, params.partnerId),
    ]);

    return {
      profile: toPartnerProfileDto(profile),
      gaps,
      readyToSubmit: gaps.length === 0,
      branches: branches.map(toPartnerBranchDto),
      qrCodes: qrCodes.map(toPartnerQrDto),
      posTerminals: terminals.map(toPartnerPosTerminalDto),
    };
  }

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
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
  ) {
    return this.contact.request(tenantIdFromHeader(tenantIdHeader), params.partnerId);
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
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(contactVerificationSubmitSchema)) body: ContactVerificationSubmitDto,
  ) {
    return this.contact.submit(tenantIdFromHeader(tenantIdHeader), params.partnerId, body.code);
  }

  /**
   * Declara al representante legal. Se AÑADE: un negocio puede tener varios apoderados, y saber
   * quién firmaba antes es lo que hace auditable un contrato viejo.
   */
  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Declarar al representante legal del comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(legalRepresentativeSchema) })
  @ApiResponse({ status: 201, description: 'Representante declarado.' })
  @Post(':partnerId/legal-representative')
  @HttpCode(HttpStatus.CREATED)
  async addLegalRepresentative(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(legalRepresentativeSchema)) body: LegalRepresentativeDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const representative = await this.profiles.addLegalRepresentative(tenantId, params.partnerId, body);
    return toPartnerRepresentativeDto(representative);
  }

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Completar la matrícula de comercio',
    description: 'Único dato del alta que el flujo admite completar después: los demás identifican al negocio.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(commercialRegistrySchema) })
  @ApiResponse({ status: 200, description: 'Matrícula registrada.' })
  @Post(':partnerId/commercial-registry')
  @HttpCode(HttpStatus.OK)
  async setCommercialRegistry(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(commercialRegistrySchema)) body: CommercialRegistryDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const profile = await this.profiles.setCommercialRegistry(tenantId, params.partnerId, body.commercialRegistry);
    return toPartnerProfileDto(profile);
  }

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Enviar el expediente a revisión',
    description: 'No aprueba: deja el caso en `under_review`. La aprobación la firma una persona.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiResponse({ status: 200, description: 'Expediente en revisión.' })
  @ApiResponse({ status: 422, description: 'PARTNER_SUBMISSION_INCOMPLETE — devuelve la lista de lo que falta.' })
  @Post(':partnerId/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const { profile } = await this.profiles.submit(tenantId, params.partnerId);
    return toPartnerProfileDto(profile);
  }
}
