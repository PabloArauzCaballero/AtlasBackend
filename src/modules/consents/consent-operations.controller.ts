/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja que Legal escriba y publique lo que el cliente acepta, sin desplegar código.
 * @system expone a operaciones el catálogo de documentos de consentimiento y su edición.
 */
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ConsentDocumentAdminService } from './consent-document-admin.service.js';
import {
  CreateConsentDocumentDto,
  UpdateConsentDocumentDto,
  createConsentDocumentSchema,
  updateConsentDocumentSchema,
} from './consents.schemas.js';

/**
 * El catálogo de lo que el cliente acepta, editable por quien lo escribe.
 *
 * Hasta aquí el texto de los consentimientos no existía en ningún sitio editable: la app pintaba una
 * casilla con el código del documento y su versión, y no había forma de leerlo ni de cambiarlo sin
 * desplegar. Cambiar una palabra de la política de privacidad era una release.
 *
 * Ese acoplamiento tiene una consecuencia concreta y mala: **nadie corrige nunca el texto**. Se
 * publica el primero que se escribió y se queda, aunque el producto haya cambiado debajo.
 *
 * ## No lo pueden tocar ni el cliente ni el comercio
 *
 * Es lo que se le opone a una persona cuando reclama. Sólo personal interno lo edita, y cada cambio
 * queda con quién lo publicó y cuándo.
 */
@ApiTags('consents')
@ApiBearerAuth('access-token')
@Controller('operations/consent-documents')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'compliance_analyst', 'risk_analyst', 'admin', 'platform_admin')
export class ConsentOperationsController {
  constructor(private readonly admin: ConsentDocumentAdminService) {}

  @ApiOperation({
    summary: 'Todos los documentos de consentimiento, no sólo los vigentes',
    description: 'Incluye borradores y retirados: quien administra el catálogo necesita ver lo que aún no publicó y lo que ya retiró.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Catálogo completo, el más reciente primero.' })
  @Get()
  list(@CurrentTenant() tenantId: string) {
    return this.admin.list(tenantId);
  }

  @ApiOperation({
    summary: 'Publicar una versión nueva de un documento',
    description:
      'Crea una versión nueva y retira la anterior del mismo código e idioma. Nunca reescribe una publicada: ' +
      'quien aceptó bajo la v1 se le juzga por la v1.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(createConsentDocumentSchema) })
  @ApiResponse({ status: 201, description: 'Versión publicada.' })
  @ApiResponse({ status: 409, description: 'CONSENT_VERSION_ALREADY_EXISTS.' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createConsentDocumentSchema)) body: CreateConsentDocumentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.admin.publish(tenantId, body, currentUser.internalUserId ?? null);
  }

  @ApiOperation({
    summary: 'Corregir el texto de un documento',
    description:
      'Sólo título, resumen, cuerpo y si exige acción explícita. El CÓDIGO y la VERSIÓN no se tocan: cambiar ' +
      'lo que dice una versión ya aceptada convertiría la evidencia en algo que no prueba nada.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(updateConsentDocumentSchema) })
  @ApiResponse({ status: 200, description: 'Documento actualizado.' })
  @ApiResponse({ status: 404, description: 'CONSENT_DOCUMENT_NOT_FOUND.' })
  @Patch(':documentId')
  update(
    @CurrentTenant() tenantId: string,
    @Param('documentId') documentId: string,
    @Body(new ZodValidationPipe(updateConsentDocumentSchema)) body: UpdateConsentDocumentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.admin.update(tenantId, documentId, body, currentUser.internalUserId ?? null);
  }
}
