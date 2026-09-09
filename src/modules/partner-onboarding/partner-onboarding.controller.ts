/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system expone el alta del expediente, su estado y su envío a revisión.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PartnerOwnershipGuard } from './partner-ownership.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { PartnerCommerceService } from './application/partner-commerce.service.js';
import { PartnerContactVerificationService } from './application/partner-contact-verification.service.js';
import { PartnerDirectoryService } from './application/partner-directory.service.js';
import { PartnerProfileService } from './application/partner-profile.service.js';
import { PartnerVerificationService } from './application/partner-verification.service.js';
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
  partnerDocumentUploadUrlSchema,
  CommercialRegistryDto,
  PartnerDocumentUploadUrlDto,
  LegalRepresentativeDto,
  legalRepresentativeSchema,
  PartnerIdParamsDto,
  UpdateCommercialProfileDto,
  partnerIdParamsSchema,
  updateCommercialProfileSchema,
  StartPartnerOnboardingDto,
  startPartnerOnboardingSchema,
} from './partner-onboarding.schemas.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';

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
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PartnerOwnershipGuard)
export class PartnerOnboardingController {
  constructor(
    private readonly profiles: PartnerProfileService,
    private readonly commerce: PartnerCommerceService,
    private readonly qr: PartnerQrService,
    private readonly contact: PartnerContactVerificationService,
    private readonly verification: PartnerVerificationService,
    private readonly directory: PartnerDirectoryService,
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
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(startPartnerOnboardingSchema)) body: StartPartnerOnboardingDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    // Quien abre el expediente queda como dueño: es contra eso que se comprueba la propiedad en
    // todas las operaciones posteriores. Ver `PartnerOwnershipGuard`.
    return toPartnerProfileDto(await this.profiles.start(tenantId, body, currentUser));
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
  @ApiOperation({ summary: 'Los expedientes de los que soy dueño' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Expedientes del comercio que hace la llamada.' })
  @Get('mine')
  async mine(@CurrentTenant() tenantId: string, @CurrentUser() currentUser: AuthenticatedUser) {
    /*
     * Va ANTES de `:partnerId/status` a proposito: Nest resuelve por orden de declaracion y
     * `mine` encajaria en el parametro, devolviendo un 404 raro en vez de la lista.
     */
    const merchantUserId = currentUser.role === 'merchant' ? (currentUser.merchantUserId ?? null) : null;
    if (!merchantUserId) return { profiles: [] };
    return { profiles: await this.directory.listOwnedBy(tenantId, merchantUserId) };
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Estado del expediente y lo que falta para enviarlo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiResponse({ status: 200, description: 'Estado, requisitos pendientes, sucursales, QR y terminales.' })
  @ApiResponse({ status: 404, description: 'Expediente no encontrado.' })
  @Get(':partnerId/status')
  async status(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto) {
    const profile = await this.profiles.requireProfile(tenantId, params.partnerId);
    const [gaps, branches, qrCodes, terminals] = await Promise.all([
      this.verification.findSubmissionGaps(tenantId, profile),
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
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(legalRepresentativeSchema)) body: LegalRepresentativeDto,
  ) {
    const representative = await this.profiles.addLegalRepresentative(tenantId, params.partnerId, body);
    return toPartnerRepresentativeDto(representative);
  }

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Permiso de subida para un documento del expediente (poder notarial)',
    description:
      'La ruta del objeto la impone el servidor bajo el prefijo del tenant y del partner, y se ' +
      'firman tipo y tamaño: el almacenamiento rechaza cualquier subida que no coincida.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(partnerDocumentUploadUrlSchema) })
  @ApiResponse({ status: 201, description: 'Permiso emitido.' })
  @Post(':partnerId/documents/upload-url')
  @HttpCode(HttpStatus.CREATED)
  async documentUploadUrl(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(partnerDocumentUploadUrlSchema)) body: PartnerDocumentUploadUrlDto,
  ) {
    return this.profiles.createDocumentUploadTicket(tenantId, params.partnerId, body);
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
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(commercialRegistrySchema)) body: CommercialRegistryDto,
  ) {
    const profile = await this.profiles.setCommercialRegistry(tenantId, params.partnerId, body.commercialRegistry);
    return toPartnerProfileDto(profile);
  }

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Corregir la ficha comercial (nombre de fachada, rubro, teléfono)',
    description:
      'Admite el expediente ya aprobado: son datos que cambian mientras el negocio opera. Razón ' +
      'social, NIT y matrícula no se tocan aquí — son lo que el analista verificó.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(updateCommercialProfileSchema) })
  @ApiResponse({ status: 200, description: 'Ficha actualizada.' })
  @ApiResponse({ status: 422, description: 'PARTNER_NETWORK_NOT_EDITABLE_IN_STATUS.' })
  @Patch(':partnerId/commercial-profile')
  @HttpCode(HttpStatus.OK)
  async updateCommercialProfile(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(updateCommercialProfileSchema)) body: UpdateCommercialProfileDto,
  ) {
    const profile = await this.profiles.updateCommercialProfile(tenantId, params.partnerId, body);
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
  async submit(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto) {
    const { profile } = await this.profiles.submit(tenantId, params.partnerId);
    return toPartnerProfileDto(profile);
  }

  /*
   * `POST /partner-onboarding/:partnerId/decision` SE RETIRÓ. No es un olvido.
   *
   * Era la MISMA operación que `POST /operations/partners/:partnerId/decision`: los mismos roles,
   * el mismo `profiles.decide()`. Dos rutas para una operación no son una comodidad: son dos sitios
   * donde arreglar un fallo, dos contratos que se separan en cuanto uno cambia, y dos respuestas a
   * «¿por dónde se decide un expediente?».
   *
   * Se queda la de `operations/partners`, que es donde vive la cola y donde la decisión manual
   * convive con el 409 que la delega al Motor cuando éste abrió caso. Esta ruta no llevaba esa
   * comprobación, así que además era la puerta por la que se podía decidir un expediente que el
   * Motor ya tenía en su bandeja.
   */
}
