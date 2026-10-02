/**
 * @file Controlador HTTP: expone endpoints y delega la lógica a servicios.
 * @business Esta pieza es el almacén de documentos que el ERP promete y hasta ahora no tenía.
 * @system permiso de subida firmado, verificación del objeto y lectura por bytes, sólo para roles internos.
 */
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ErpDocumentsService } from './application/erp-documents.service.js';
import { ErpMerchantExpedienteService } from './application/erp-merchant-expediente.service.js';
import { PartnerQrService } from './application/partner-qr.service.js';
import { PartnerRepresentativeService } from './application/partner-representative.service.js';
import {
  ErpDocumentContentQueryDto,
  erpDocumentContentQuerySchema,
  ErpDocumentUploadUrlDto,
  erpDocumentUploadUrlSchema,
  ErpDocumentVerifyDto,
  erpDocumentVerifySchema,
  ErpMerchantExpedienteDto,
  erpMerchantExpedienteSchema,
  ErpMerchantExpedienteUploadUrlDto,
  erpMerchantExpedienteUploadUrlSchema,
} from './erp-documents.schemas.js';
import { partnerIdParamsSchema, PartnerIdParamsDto } from './partner-onboarding.schemas.js';

/**
 * `/operations/erp-documents`: lo que el ERP usa para guardar los documentos KYB de sus cuentas y
 * los requisitos del checklist de onboarding. Llega con el token interno de la persona que opera el
 * ERP (la cookie `atlas_upstream_at`), así que son roles internos, no de comercio.
 */
@ApiTags('partner-onboarding')
@ApiBearerAuth('access-token')
@Controller('operations/erp-documents')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class ErpDocumentsController {
  constructor(
    private readonly documents: ErpDocumentsService,
    private readonly merchantExpediente: ErpMerchantExpedienteService,
    private readonly representatives: PartnerRepresentativeService,
    private readonly qr: PartnerQrService,
  ) {}

  @ApiOperation({
    summary: 'Asegurar la carpeta y el expediente del comercio de una cuenta del ERP',
    description:
      'Busca la ficha del comercio por la cuenta del ERP o por NIT; si no existe la abre (sin dueño). La enlaza a la cuenta, asegura su expediente con las carpetas qr, documentos y otros, y carga lo que el ERP capturó en el alta (matrícula, representante legal con poder, sucursal, QR bancario) sin repetir lo que ya estaba. Con `submitWhenComplete` y sin huecos, lo envía a revisión. Idempotente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(erpMerchantExpedienteSchema) })
  @ApiResponse({ status: 200, description: '{ partnerId, expedienteId, created, reason, loaded, gaps, onboardingStatus }.' })
  @Post('merchant-expediente')
  @HttpCode(HttpStatus.OK)
  merchantExpedienteDeCuenta(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(erpMerchantExpedienteSchema)) body: ErpMerchantExpedienteDto,
  ) {
    return this.merchantExpediente.asegurar(tenantId, body);
  }

  @ApiOperation({
    summary: 'Permiso de subida DENTRO de la carpeta del comercio (poder notarial o QR bancario capturados en el ERP)',
    description:
      'La ruta la impone el servidor bajo `<tenant>/partner-<id>/`, igual que cuando sube el propio comercio: así el objeto pasa las mismas comprobaciones de propiedad al registrarse.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'partnerId', schema: zodToApiSchema(partnerIdParamsSchema.shape.partnerId) })
  @ApiBody({ schema: zodToApiSchema(erpMerchantExpedienteUploadUrlSchema) })
  @ApiResponse({ status: 201, description: 'Permiso emitido.' })
  @ApiResponse({ status: 503, description: 'DOCUMENT_STORAGE_NOT_CONFIGURED.' })
  @Post('merchant-expediente/:partnerId/upload-url')
  @HttpCode(HttpStatus.CREATED)
  merchantExpedienteUploadUrl(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(partnerIdParamsSchema)) params: PartnerIdParamsDto,
    @Body(new ZodValidationPipe(erpMerchantExpedienteUploadUrlSchema)) body: ErpMerchantExpedienteUploadUrlDto,
  ) {
    if (body.documentKind === 'bank-qr') {
      return this.qr.createUploadTicket(tenantId, params.partnerId, {
        qrKind: 'bank',
        contentType: body.contentType as 'image/png' | 'image/jpeg',
        sizeBytes: body.sizeBytes,
      });
    }
    return this.representatives.createDocumentUploadTicket(tenantId, params.partnerId, {
      documentKind: 'power-of-attorney',
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });
  }

  @ApiOperation({
    summary: 'Permiso de subida para un documento del ERP',
    description: 'La ruta del objeto la impone el servidor bajo `<tenant>/erp-<dueño>/`; se firman tipo y tamaño.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(erpDocumentUploadUrlSchema) })
  @ApiResponse({ status: 201, description: 'Permiso emitido.' })
  @ApiResponse({ status: 503, description: 'DOCUMENT_STORAGE_NOT_CONFIGURED.' })
  @Post('upload-url')
  @HttpCode(HttpStatus.CREATED)
  uploadUrl(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(erpDocumentUploadUrlSchema)) body: ErpDocumentUploadUrlDto) {
    return this.documents.createUploadTicket({ tenantId, ...body });
  }

  @ApiOperation({
    summary: 'Verificar un documento del ERP ya subido',
    description: 'Comprueba prefijo de propiedad, existencia, hash, tamaño y tipo real del objeto antes de que el ERP lo registre.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(erpDocumentVerifySchema) })
  @ApiResponse({ status: 200, description: 'Metadatos reales del objeto.' })
  @ApiResponse({ status: 422, description: 'ERP_DOCUMENT_KEY_NOT_OWNED, EVIDENCE_OBJECT_NOT_FOUND, EVIDENCE_HASH_MISMATCH…' })
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(erpDocumentVerifySchema)) body: ErpDocumentVerifyDto) {
    const metadata = await this.documents.verify({
      tenantId,
      storageKey: body.storageKey,
      sha256: body.sha256,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes ?? null,
    });
    return { storageKey: body.storageKey, sizeBytes: metadata.sizeBytes, sha256: metadata.sha256Hex, contentType: metadata.contentType };
  }

  @ApiOperation({ summary: 'Los bytes de un documento del ERP, para verlo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'El archivo.' })
  @ApiResponse({ status: 404, description: 'ERP_DOCUMENT_NOT_FOUND.' })
  @Get('content')
  @Header('Cache-Control', 'private, max-age=60')
  async content(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(erpDocumentContentQuerySchema)) query: ErpDocumentContentQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const documento = await this.documents.read(tenantId, query.storageKey);
    response.setHeader('Content-Type', documento.contentType);
    return new StreamableFile(documento.bytes);
  }
}
