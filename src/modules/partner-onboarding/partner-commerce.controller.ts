/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system expone los locales del partner, la subida de sus QR de cobro y el alta de sus terminales.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { PartnerOwnershipGuard } from './partner-ownership.guard.js';
import { PartnerCommerceService } from './application/partner-commerce.service.js';
import { PartnerQrService } from './application/partner-qr.service.js';
import { toPartnerBranchDto, toPartnerPosTerminalDto, toPartnerQrDto } from './partner-onboarding.mapper.js';
import {
  BranchIdParamsDto,
  branchIdParamsSchema,
  PartnerIdParamsDto,
  partnerIdParamsSchema,
  PosTerminalStatusDto,
  posTerminalStatusSchema,
  QrUploadUrlDto,
  qrUploadUrlSchema,
  RegisterBranchDto,
  registerBranchSchema,
  RegisterPosTerminalDto,
  registerPosTerminalSchema,
  RegisterQrDto,
  registerQrSchema,
  TerminalIdParamsDto,
  terminalIdParamsSchema,
} from './partner-onboarding.schemas.js';

/**
 * Lo que el comercio opera de su propio expediente: sus locales, sus dos QR y sus terminales.
 *
 * Va en un controlador aparte del expediente por tamaño y por lectura: aquél responde «¿en qué
 * estado está mi trámite?» y éste «¿con qué cobro y desde dónde?», que es lo que el comercio abre
 * a diario una vez aprobado.
 */
@ApiTags('partner-onboarding')
@Controller('partner-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PartnerOwnershipGuard)
export class PartnerCommerceController {
  constructor(
    private readonly commerce: PartnerCommerceService,
    private readonly qr: PartnerQrService,
  ) {}

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Registrar una sucursal del comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(registerBranchSchema) })
  @ApiResponse({ status: 201, description: 'Sucursal registrada.' })
  @ApiResponse({ status: 409, description: 'BRANCH_CODE_ALREADY_REGISTERED.' })
  @Post(':partnerId/branches')
  @HttpCode(HttpStatus.CREATED)
  async registerBranch(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(registerBranchSchema)) body: RegisterBranchDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    return toPartnerBranchDto(await this.commerce.registerBranch(tenantId, params.partnerId, body));
  }

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Sucursales del comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiResponse({ status: 200, description: 'Listado de sucursales.' })
  @Get(':partnerId/branches')
  async listBranches(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const branches = await this.commerce.listBranches(tenantId, params.partnerId);
    return branches.map(toPartnerBranchDto);
  }

  /**
   * Paso 1 de la subida del QR: el permiso.
   *
   * El servidor impone la ruta y firma tipo y tamaño. Si el cliente eligiera la ruta podría
   * escribir sobre la evidencia de otro expediente, que es el punto ciego que este flujo de dos
   * pasos existe para cerrar.
   */
  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Pedir permiso de subida para un QR (negocio o bancario)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(qrUploadUrlSchema) })
  @ApiResponse({ status: 201, description: 'Ticket de subida firmado, con sus cabeceras obligatorias.' })
  @ApiResponse({ status: 503, description: 'DOCUMENT_STORAGE_NOT_CONFIGURED.' })
  @Post(':partnerId/qr-codes/upload-url')
  @HttpCode(HttpStatus.CREATED)
  async createQrUploadUrl(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(qrUploadUrlSchema)) body: QrUploadUrlDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    return this.qr.createUploadTicket(tenantId, params.partnerId, body);
  }

  /**
   * Paso 2: registrar el QR ya subido. El servidor MIRA el objeto antes de escribir la fila.
   */
  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Registrar el QR subido',
    description:
      'Descarga el objeto, comprueba que es una imagen y guarda su hash. Si ya había un QR vigente ' +
      'del mismo tipo y ámbito, queda como `replaced` apuntando al nuevo: nunca se sobrescribe.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(registerQrSchema) })
  @ApiResponse({ status: 201, description: 'QR registrado, en `pending_review`.' })
  @ApiResponse({ status: 422, description: 'QR_OBJECT_NOT_FOUND | QR_OBJECT_NOT_AN_IMAGE.' })
  @Post(':partnerId/qr-codes')
  @HttpCode(HttpStatus.CREATED)
  async registerQr(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(registerQrSchema)) body: RegisterQrDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    return toPartnerQrDto(await this.qr.register(tenantId, params.partnerId, body));
  }

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'QR del comercio, con su estado y su historial de reemplazos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiResponse({ status: 200, description: 'Listado de QR.' })
  @Get(':partnerId/qr-codes')
  async listQr(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const codes = await this.qr.list(tenantId, params.partnerId);
    return codes.map(toPartnerQrDto);
  }

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Registrar un terminal POS en una sucursal' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiParam({ name: 'branchId', schema: zodToApiSchema(branchIdParamsSchema.shape.branchId) })
  @ApiBody({ schema: zodToApiSchema(registerPosTerminalSchema) })
  @ApiResponse({ status: 201, description: 'Terminal registrado, en `registered`.' })
  @ApiResponse({ status: 404, description: 'La sucursal no pertenece a este partner.' })
  @ApiResponse({ status: 409, description: 'POS_SERIAL_ALREADY_REGISTERED.' })
  @Post(':partnerId/branches/:branchId/pos-terminals')
  @HttpCode(HttpStatus.CREATED)
  async registerPos(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(branchIdParamsSchema)) params: BranchIdParamsDto,
    @Body(new ZodValidationPipe(registerPosTerminalSchema)) body: RegisterPosTerminalDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const terminal = await this.commerce.registerPosTerminal(tenantId, params.partnerId, params.branchId, body);
    return toPartnerPosTerminalDto(terminal);
  }

  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Terminales del comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiResponse({ status: 200, description: 'Listado de terminales.' })
  @Get(':partnerId/pos-terminals')
  async listPos(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const terminals = await this.commerce.listPosTerminals(tenantId, params.partnerId);
    return terminals.map(toPartnerPosTerminalDto);
  }

  /**
   * Activar, suspender o retirar un terminal.
   *
   * Se puede sobre un expediente YA APROBADO a propósito: suspender un equipo perdido es una
   * medida de contención, y exigir que el expediente estuviera en borrador se la negaría justo al
   * comercio que sí puede cobrar.
   */
  @Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cambiar el estado de un terminal' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiParam({ name: 'terminalId', schema: zodToApiSchema(terminalIdParamsSchema.shape.terminalId) })
  @ApiBody({ schema: zodToApiSchema(posTerminalStatusSchema) })
  @ApiResponse({ status: 200, description: 'Estado actualizado.' })
  @ApiResponse({ status: 404, description: 'Terminal no encontrado para este partner.' })
  @Patch(':partnerId/pos-terminals/:terminalId')
  async changePosStatus(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(terminalIdParamsSchema)) params: TerminalIdParamsDto,
    @Body(new ZodValidationPipe(posTerminalStatusSchema)) body: PosTerminalStatusDto,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const terminal = await this.commerce.changePosStatus(tenantId, params.partnerId, params.terminalId, body);
    return toPartnerPosTerminalDto(terminal);
  }
}
