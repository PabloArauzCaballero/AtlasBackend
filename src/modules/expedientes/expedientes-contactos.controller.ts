/**
 * @file Controlador HTTP: traduce peticiones a casos de uso y respuestas tipadas.
 * @business Los teléfonos y las referencias de una persona, tapados salvo que haya un motivo.
 * @system compone los contactos desde la base; revelarlos exige permiso propio y deja constancia.
 */
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ContactosService } from './application/contactos.service.js';
import { ExpedienteService } from './application/expediente.service.js';
import { ExpedienteAccesoGuard, NivelRequerido, type RequestConExpediente } from './guards/expediente-acceso.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import {
  contactosQuerySchema,
  expedienteParamsSchema,
  revelarContactosBodySchema,
  type ContactosQueryDto,
  type ExpedienteParamsDto,
  type RevelarContactosBodyDto,
} from './expedientes.schemas.js';

/**
 * Los contactos, en su propio controlador.
 *
 * Es el único endpoint del expediente que puede devolver datos personales SIN tapar, y el único
 * que los toma de PostgreSQL en vez del almacén. Separarlo hace que su permiso —`pii.revelar`— y
 * su `Cache-Control` se lean de un vistazo, en lugar de quedar entre doce endpoints de árbol donde
 * nadie repara en que ese es distinto.
 */
@ApiTags('Expedientes')
@ApiBearerAuth('access-token')
@Controller('expedientes/:id/contactos')
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
@UseGuards(TenantGuard, ExpedienteAccesoGuard)
export class ExpedientesContactosController {
  constructor(
    private readonly contactos: ContactosService,
    private readonly expedientes: ExpedienteService,
  ) {}

  /**
   * Los contactos del expediente, compuestos desde la base.
   *
   * En la pantalla es un ARCHIVO más de la carpeta —un nodo virtual—, y quien lo abre espera el
   * mismo gesto que abrir el carnet. Lo que cambia es de dónde salen los bytes: de PostgreSQL, no
   * del almacén, porque los contactos ya viven en la base y duplicarlos en un objeto crearía una
   * segunda copia de datos personales con menos controles.
   */
  @Get()
  @ApiOperation({
    summary: 'Contactos y referencias del cliente, enmascarados',
    description:
      'Enmascarados. `revelar=true` con `motivo` en la query sigue funcionando por compatibilidad, pero está ' +
      'OBSOLETO: el motivo acaba en los registros de acceso. Para revelar, `POST /expedientes/:id/contactos/revelar`.',
  })
  @ApiQuery({ name: 'revelar', required: false, enum: ['true', 'false'], deprecated: true })
  @ApiQuery({ name: 'motivo', required: false, type: String, deprecated: true })
  @ApiOkResponse({ description: 'El JSON de contactos. Con `revelar=true` exige permiso y motivo.' })
  @Header('Cache-Control', 'private, no-store')
  @NivelRequerido('leer')
  async obtenerContactos(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Query(new ZodValidationPipe(contactosQuerySchema)) query: ContactosQueryDto,
    @Req() request: RequestConExpediente,
  ) {
    const expediente = await this.expedientes.obtener(tenantId, params.id);
    return this.contactos.componer({
      tenantId,
      expedienteId: params.id,
      customerId: expediente.subjectId,
      actor: request.expediente!.actor,
      revelar: query.revelar,
      motivo: query.motivo,
    });
  }

  /**
   * Revelar los contactos sin tapar (ADM-10). Lo mismo que `GET ?revelar=true`, con el motivo en el cuerpo.
   *
   * Mismo rol, mismo nivel sobre la carpeta, mismo permiso (`expedientes.pii.revelar`, lo comprueba el servicio) y
   * misma constancia `revelar_pii` en la bitácora del expediente: el único cambio es por dónde viaja el motivo. Es un
   * POST y no un GET con cuerpo porque revelar es una ACCIÓN que deja rastro, y un GET no debería tenerla.
   */
  @Post('revelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revelar contactos y referencias del cliente, con motivo' })
  @ApiBody({ schema: zodToApiSchema(revelarContactosBodySchema) })
  @ApiOkResponse({ description: 'El JSON de contactos sin enmascarar. Exige `expedientes.pii.revelar` y un motivo de 8+ caracteres.' })
  @Header('Cache-Control', 'private, no-store')
  @NivelRequerido('leer')
  async revelarContactos(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Body(new ZodValidationPipe(revelarContactosBodySchema)) body: RevelarContactosBodyDto,
    @Req() request: RequestConExpediente,
  ) {
    const expediente = await this.expedientes.obtener(tenantId, params.id);
    return this.contactos.componer({
      tenantId,
      expedienteId: params.id,
      customerId: expediente.subjectId,
      actor: request.expediente!.actor,
      revelar: true,
      motivo: body.motivo,
    });
  }
}
