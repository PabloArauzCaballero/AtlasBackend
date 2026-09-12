/**
 * @file Adaptador HTTP: publicar y consultar el contrato legal por defecto del inquilino.
 * @business Es lo que fija bajo qué texto opera un comercio al que nadie le negoció uno propio.
 * @system tres rutas de operaciones; la consulta del predeterminado la usa además el ERP.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { PartnerContractTemplateService } from './application/partner-contract-template.service.js';
import { toContractTemplateDto } from './partner-onboarding.mapper.js';
import { PublishContractTemplateDto, publishContractTemplateSchema } from './partner-operations.schemas.js';

/**
 * El contrato bajo el que se afilia un comercio.
 *
 * La verificación del expediente comprobaba matrícula, representante, QR y correo —todo lo que
 * prueba que el comercio EXISTE— y nada comprobaba que hubiera un contrato. Se habilitaba a cobrar
 * a un comercio con el que no se había pactado por escrito ni la comisión, ni los plazos de
 * liquidación, ni qué pasa con una devolución.
 *
 * Publicar es de operaciones. **Consultar el predeterminado lo puede hacer también el ERP**, con el
 * mismo permiso con el que pide la verificación (`partner.kyb.request`): necesita saber qué texto
 * enseñarle al comercio al afiliarlo, y no tiene por qué guardar una copia que se desincronice.
 */
@ApiTags('partner-onboarding')
@ApiBearerAuth('access-token')
@Controller('operations/partner-contract-templates')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, InternalPermissionsGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class PartnerContractTemplatesController {
  constructor(private readonly templates: PartnerContractTemplateService) {}

  @ApiOperation({
    summary: 'El contrato por defecto vigente del inquilino',
    description:
      'Responde 200 con `null` cuando el inquilino todavía no publicó ninguno: un inquilino recién abierto no tiene contrato, ' +
      'y decirlo es más útil que un 404 que quien llama tendría que traducir.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'La plantilla vigente, o null.' })
  @Get('default')
  @InternalPermissions('partner.kyb.request')
  async getDefault(@CurrentTenant() tenantId: string) {
    const plantilla = await this.templates.findDefault(tenantId);
    return { template: plantilla ? toContractTemplateDto(plantilla) : null };
  }

  @ApiOperation({
    summary: 'Todas las versiones publicadas, vigentes y archivadas',
    description: 'Las archivadas NO se ocultan: son la prueba de qué texto regía cada día.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Listado por código y versión descendente.' })
  @Get()
  async list(@CurrentTenant() tenantId: string) {
    const plantillas = await this.templates.list(tenantId);
    return { items: plantillas.map(toContractTemplateDto) };
  }

  @ApiOperation({
    summary: 'Publicar una versión nueva del contrato',
    description:
      'El cuerpo NO se edita: cada publicación crea una versión y archiva la anterior. La versión la calcula el backend; ' +
      'pedirla desde fuera invita a repetirla o a saltársela, y es justo el número que después se cita.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(publishContractTemplateSchema) })
  @ApiResponse({ status: 201, description: 'Versión publicada.' })
  @Post()
  async publish(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(publishContractTemplateSchema)) body: PublishContractTemplateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const creada = await this.templates.publish(tenantId, {
      ...body,
      internalUserId: currentUser.internalUserId ? String(currentUser.internalUserId) : null,
    });
    return toContractTemplateDto(creada);
  }

  @ApiOperation({
    summary: 'Marcar como predeterminada una versión ya publicada',
    description: 'Sólo una vigente: revivir un texto archivado desharía la retirada de quien tuvo un motivo para retirarlo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Plantilla marcada como predeterminada.' })
  @ApiResponse({ status: 404, description: 'PARTNER_CONTRACT_TEMPLATE_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'PARTNER_CONTRACT_TEMPLATE_ARCHIVED.' })
  @Patch(':templateId/default')
  @HttpCode(HttpStatus.OK)
  async setDefault(@CurrentTenant() tenantId: string, @Param('templateId') templateId: string) {
    return toContractTemplateDto(await this.templates.setDefault(tenantId, templateId));
  }
}
