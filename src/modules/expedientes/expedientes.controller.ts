/**
 * @file Controlador HTTP: traduce peticiones a casos de uso y respuestas tipadas.
 * @business Da a quien revisa un caso la carpeta completa del cliente, con lo que puede ver.
 * @system expone el listado de expedientes, su detalle y su bitácora.
 */
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ExpedienteService } from './application/expediente.service.js';
import { ConcesionService } from './application/concesion.service.js';
import { ExpedientesRepository } from './repositories/expedientes.repository.js';
import { ExpedienteAccesoGuard, NivelRequerido, type RequestConExpediente } from './guards/expediente-acceso.guard.js';
import { toActividadDto, toExpedienteDto } from './expedientes.mapper.js';
import {
  actividadQuerySchema,
  expedienteParamsSchema,
  listarExpedientesQuerySchema,
  sujetoParamsSchema,
  type ActividadQueryDto,
  type ExpedienteParamsDto,
  type ListarExpedientesQueryDto,
  type SujetoParamsDto,
} from './expedientes.schemas.js';

/**
 * El explorador de expedientes.
 *
 * Los roles de `@Roles(...)` son EXACTAMENTE los que ya protegen `investigation-summary`: quien
 * puede leer el resumen de investigación de un cliente puede, con el permiso adecuado, abrir su
 * carpeta. Poner aquí una lista distinta habría creado dos respuestas a la misma pregunta.
 *
 * El nivel fino lo decide `ExpedienteAccesoGuard` con `@NivelRequerido`.
 */
@ApiTags('Expedientes')
@ApiBearerAuth('access-token')
@Controller('expedientes')
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
@UseGuards(ExpedienteAccesoGuard)
export class ExpedientesController {
  constructor(
    private readonly expedientes: ExpedienteService,
    private readonly concesiones: ConcesionService,
    private readonly repository: ExpedientesRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Expedientes del tenant, con su estado y tamaño' })
  @ApiOkResponse({ description: 'Página de expedientes ordenada por creación descendente.' })
  @NivelRequerido('leer')
  async listar(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(listarExpedientesQuerySchema)) query: ListarExpedientesQueryDto,
    @Req() request: RequestConExpediente,
  ) {
    const { rows, count } = await this.expedientes.listar({
      tenantId,
      subjectType: query.subjectType,
      estado: query.estado,
      q: query.q,
      offset: (query.page - 1) * query.pageSize,
      limit: query.pageSize,
    });

    const actor = request.expediente!.actor;
    const base = this.concesiones.nivelBase(actor);
    const items = await Promise.all(
      rows.map(async (expediente) => {
        const nodos = await this.repository.listarTodosLosNodos(tenantId, expediente.id);
        const bytes = nodos.reduce((total, nodo) => total + Number(nodo.sizeBytes ?? 0), 0);
        return toExpedienteDto(expediente, {
          nivelEfectivo: base,
          nodos: nodos.filter((nodo) => nodo.tipo === 'archivo').length,
          bytes: String(bytes),
        });
      }),
    );

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: count,
      totalPages: Math.max(1, Math.ceil(count / query.pageSize)),
      hasNextPage: query.page * query.pageSize < count,
    };
  }

  /**
   * El expediente de un sujeto, sin saber su identificador de expediente.
   *
   * Es la puerta que usa la revisión humana: llega con un `customerId` desde la cola de trabajo y
   * necesita la carpeta. Sin esta ruta, la pantalla tendría que listar y filtrar, que es una
   * consulta cara para resolver una relación que la base ya tiene indexada.
   */
  @Get('por-sujeto/:subjectType/:subjectId')
  @ApiOperation({ summary: 'El expediente de un cliente, comercio o reclamo' })
  @ApiOkResponse({ description: 'El expediente, o 200 con `null` si el sujeto aún no tiene uno.' })
  @NivelRequerido('leer')
  async porSujeto(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(sujetoParamsSchema)) params: SujetoParamsDto,
    @Query('sessionId') sessionId: string | undefined,
    @Req() request: RequestConExpediente,
  ) {
    const expediente = await this.expedientes.porSujeto(tenantId, params.subjectType, params.subjectId, sessionId ?? null);
    // `null` y no 404: «este cliente no tiene expediente» es una respuesta legítima que la pantalla
    // pinta como un estado vacío, no como un error.
    if (!expediente) return null;

    const nivel = await this.concesiones.resolver({
      tenantId,
      expedienteId: expediente.id,
      actor: request.expediente!.actor,
      ruta: '',
      expedientePurgado: expediente.purgadoEn !== null,
    });
    if (!nivel) return null;

    const nodos = await this.repository.listarTodosLosNodos(tenantId, expediente.id);
    return toExpedienteDto(expediente, {
      nivelEfectivo: nivel,
      nodos: nodos.filter((nodo) => nodo.tipo === 'archivo').length,
      bytes: String(nodos.reduce((total, nodo) => total + Number(nodo.sizeBytes ?? 0), 0)),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Un expediente y su estado' })
  @ApiOkResponse({ description: 'El expediente con el nivel efectivo de quien pregunta.' })
  @NivelRequerido('leer')
  async obtener(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Req() request: RequestConExpediente,
  ) {
    const expediente = await this.expedientes.obtener(tenantId, params.id);
    const nodos = await this.repository.listarTodosLosNodos(tenantId, expediente.id);
    return toExpedienteDto(expediente, {
      nivelEfectivo: request.expediente!.nivel,
      nodos: nodos.filter((nodo) => nodo.tipo === 'archivo').length,
      bytes: String(nodos.reduce((total, nodo) => total + Number(nodo.sizeBytes ?? 0), 0)),
    });
  }

  @Get(':id/actividad')
  @ApiOperation({ summary: 'Quién vio, subió, compartió o borró en este expediente' })
  @ApiOkResponse({ description: 'Página de la bitácora, de lo más reciente a lo más antiguo.' })
  @NivelRequerido('leer')
  async actividad(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Query(new ZodValidationPipe(actividadQuerySchema)) query: ActividadQueryDto,
  ) {
    const { rows, count } = await this.repository.listarActividad({
      tenantId,
      expedienteId: params.id,
      nodoId: query.nodoId,
      offset: (query.page - 1) * query.pageSize,
      limit: query.pageSize,
    });
    return {
      items: rows.map(toActividadDto),
      page: query.page,
      pageSize: query.pageSize,
      total: count,
      totalPages: Math.max(1, Math.ceil(count / query.pageSize)),
      hasNextPage: query.page * query.pageSize < count,
    };
  }
}
