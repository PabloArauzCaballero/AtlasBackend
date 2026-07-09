import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas } from '../../common/openapi/zod-to-schema.util.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { ConsentsService } from './consents.service.js';
import { listActiveConsentDocumentsQuerySchema, ListActiveConsentDocumentsQueryDto } from './consents.schemas.js';

@ApiTags('consents')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @Public()
  @ApiOperation({
    summary: 'Listar documentos de consentimiento activos',
    description:
      'Devuelve los documentos legales (términos, política de privacidad, etc.) publicados y vigentes para el tenant/idioma dado. ' +
      'Endpoint público (sin token) — se consulta antes del login, durante onboarding. `purposeCode` filtra por `documentCode` ' +
      '(el nombre del parámetro no corresponde 1:1 al propósito de negocio real, ver `consents.schemas.ts`).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'language', required: false, schema: zodObjectPropertySchemas(listActiveConsentDocumentsQuerySchema).language })
  @ApiQuery({ name: 'purposeCode', required: false, schema: zodObjectPropertySchemas(listActiveConsentDocumentsQuerySchema).purposeCode })
  @ApiResponse({ status: 200, description: 'Lista de documentos activos (puede ser vacía).' })
  @ApiResponse({ status: 400, description: 'x-tenant-id ausente o inválido.' })
  @Get('consent-documents/active')
  listActiveDocuments(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listActiveConsentDocumentsQuerySchema)) query: ListActiveConsentDocumentsQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.consentsService.listActiveDocuments(tenantId, query);
  }
}
