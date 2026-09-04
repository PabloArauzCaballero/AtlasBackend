/**
 * @file Controlador HTTP: traduce peticiones a casos de uso y respuestas tipadas.
 * @business Deja recorrer, abrir, subir y ordenar los archivos del expediente de una persona.
 * @system expone el árbol, el contenido y las mutaciones sobre nodos.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ExpedienteService } from './application/expediente.service.js';
import { ConcesionService } from './application/concesion.service.js';
import { ContactosService } from './application/contactos.service.js';
import { ContenidoService } from './application/contenido.service.js';
import { NodoService } from './application/nodo.service.js';
import { NodoMovimientoService } from './application/nodo-movimiento.service.js';
import { SubidaService } from './application/subida.service.js';
import { ExpedienteAccesoGuard, NivelRequerido, type RequestConExpediente } from './guards/expediente-acceso.guard.js';
import { toNodoDto } from './expedientes.mapper.js';
import {
  actualizarNodoSchema,
  contenidoQuerySchema,
  crearCarpetaSchema,
  crearSubidaSchema,
  expedienteParamsSchema,
  listarNodosQuerySchema,
  nodoParamsSchema,
  purgarSchema,
  type ActualizarNodoDto,
  type ContenidoQueryDto,
  type CrearCarpetaDto,
  type CrearSubidaDto,
  type ExpedienteParamsDto,
  type ListarNodosQueryDto,
  type NodoParamsDto,
  type PurgarDto,
} from './expedientes.schemas.js';

@ApiTags('Expedientes')
@ApiBearerAuth('access-token')
@Controller('expedientes/:id')
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
@UseGuards(ExpedienteAccesoGuard)
export class ExpedientesNodosController {
  constructor(
    private readonly nodos: NodoService,
    private readonly movimiento: NodoMovimientoService,
    private readonly contenido: ContenidoService,
    private readonly subidas: SubidaService,
    private readonly expedientes: ExpedienteService,
    private readonly concesiones: ConcesionService,
    private readonly contactos: ContactosService,
  ) {}

  @Get('nodos')
  @ApiOperation({ summary: 'Los nodos de una carpeta del expediente' })
  @ApiOkResponse({ description: 'Carpetas primero y archivos después, por nombre.' })
  @NivelRequerido('leer')
  async listar(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Query(new ZodValidationPipe(listarNodosQuerySchema)) query: ListarNodosQueryDto,
    @Req() request: RequestConExpediente,
  ) {
    const hijos = await this.nodos.listarHijos({
      tenantId,
      expedienteId: params.id,
      parentId: query.parentId ?? null,
      incluirPapelera: query.incluirPapelera,
      q: query.q,
    });
    // El nivel de cada hijo se resuelve con el del expediente ya calculado por el guard: recalcular
    // uno por fila haría tantas consultas de concesiones como archivos tenga la carpeta.
    return hijos.map((nodo) => toNodoDto(nodo, request.expediente!.nivel));
  }

  /**
   * Los bytes de un archivo.
   *
   * `no-store` y no una caché privada: es la cara o el documento de identidad de una persona, y una
   * copia en el disco del navegador de quien revisa sobrevive a que se le retire el acceso.
   */
  @Get('nodos/:nodoId/contenido')
  @ApiOperation({ summary: 'El contenido de un archivo del expediente' })
  @ApiOkResponse({
    description: 'Los bytes, con su tipo real. Queda registrado quién lo abrió.',
    content: {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
      'image/png': { schema: { type: 'string', format: 'binary' } },
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Header('Cache-Control', 'private, no-store')
  @NivelRequerido('leer')
  async obtenerContenido(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(nodoParamsSchema)) params: NodoParamsDto,
    @Query(new ZodValidationPipe(contenidoQuerySchema)) query: ContenidoQueryDto,
    @Req() request: RequestConExpediente,
    @Res() response: Response,
  ): Promise<void> {
    const nodo = await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId);
    const archivo = await this.contenido.leer({
      tenantId,
      expedienteId: params.id,
      nodo,
      actor: request.expediente!.actor,
      descarga: query.disposition === 'attachment',
      ip: request.ip ?? null,
      requestId: request.correlationId ?? null,
    });

    response.setHeader('Content-Type', archivo.contentType);
    response.setHeader('Content-Length', String(archivo.bytes.byteLength));
    if (nodo.sha256) response.setHeader('ETag', `"${nodo.sha256}"`);
    if (query.disposition === 'attachment') {
      // El nombre se sanea otra vez aquí: viaja en una cabecera, y una comilla partiría el valor.
      response.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre.replace(/["\\]/g, '')}"`);
    }
    response.end(archivo.bytes);
  }

  @Post('carpetas')
  @ApiOperation({ summary: 'Crea una carpeta dentro del expediente' })
  @ApiOkResponse({ description: 'La carpeta creada.' })
  @NivelRequerido('escribir')
  async crearCarpeta(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Body(new ZodValidationPipe(crearCarpetaSchema)) body: CrearCarpetaDto,
    @Req() request: RequestConExpediente,
  ) {
    const nodo = await this.nodos.crearCarpeta({
      tenantId,
      expedienteId: params.id,
      parentId: body.parentId ?? null,
      nombre: body.nombre,
      actor: request.expediente!.actor,
    });
    return toNodoDto(nodo, request.expediente!.nivel);
  }

  @Post('subidas')
  @ApiOperation({ summary: 'Permiso de subida: el navegador escribe directo en el almacén' })
  @ApiOkResponse({ description: 'Ticket con la URL firmada y las cabeceras exactas.' })
  @NivelRequerido('escribir')
  async crearSubida(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Body(new ZodValidationPipe(crearSubidaSchema)) body: CrearSubidaDto,
    @Req() request: RequestConExpediente,
  ) {
    return this.subidas.emitirTicket({
      tenantId,
      expedienteId: params.id,
      parentId: body.parentId ?? null,
      nombre: body.nombre,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      actor: request.expediente!.actor,
    });
  }

  @Post('subidas/:ticketId/confirmar')
  @ApiOperation({ summary: 'Confirma la subida: verifica los bytes y crea el nodo' })
  @ApiOkResponse({ description: 'El archivo ya en el expediente.' })
  @NivelRequerido('escribir')
  async confirmarSubida(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Param('ticketId') ticketId: string,
    @Req() request: RequestConExpediente,
  ) {
    const nodo = await this.subidas.confirmar({
      tenantId,
      expedienteId: params.id,
      ticketId,
      actor: request.expediente!.actor,
    });
    return toNodoDto(nodo, request.expediente!.nivel);
  }

  @Patch('nodos/:nodoId')
  @ApiOperation({ summary: 'Renombra o mueve un nodo' })
  @ApiOkResponse({ description: 'El nodo actualizado.' })
  @NivelRequerido('escribir')
  async actualizar(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(nodoParamsSchema)) params: NodoParamsDto,
    @Body(new ZodValidationPipe(actualizarNodoSchema)) body: ActualizarNodoDto,
    @Req() request: RequestConExpediente,
  ) {
    const nodo = await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId);
    if (body.nombre !== undefined) {
      await this.movimiento.renombrar({
        tenantId,
        expedienteId: params.id,
        nodo,
        nombre: body.nombre,
        actor: request.expediente!.actor,
      });
    }
    if (body.parentId !== undefined) {
      const actualizado = await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId);
      await this.movimiento.mover({
        tenantId,
        expedienteId: params.id,
        nodo: actualizado,
        destinoId: body.parentId ?? null,
        actor: request.expediente!.actor,
      });
    }
    return toNodoDto(await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId), request.expediente!.nivel);
  }

  @Delete('nodos/:nodoId')
  @ApiOperation({ summary: 'Manda un nodo a la papelera' })
  @ApiOkResponse({ description: 'Cuántos nodos se movieron (una carpeta arrastra su contenido).' })
  @NivelRequerido('escribir')
  async borrar(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(nodoParamsSchema)) params: NodoParamsDto,
    @Req() request: RequestConExpediente,
  ) {
    const nodo = await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId);
    const movidos = await this.movimiento.borrar({
      tenantId,
      expedienteId: params.id,
      nodo,
      actor: request.expediente!.actor,
    });
    return { nodosEnPapelera: movidos };
  }

  @Post('nodos/:nodoId/restaurar')
  @ApiOperation({ summary: 'Saca un nodo de la papelera' })
  @ApiOkResponse({ description: 'El nodo restaurado, con su ruta.' })
  @NivelRequerido('escribir')
  async restaurar(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(nodoParamsSchema)) params: NodoParamsDto,
    @Req() request: RequestConExpediente,
  ) {
    const nodo = await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId);
    await this.movimiento.restaurar({ tenantId, expedienteId: params.id, nodo, actor: request.expediente!.actor });
    return toNodoDto(await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId), request.expediente!.nivel);
  }

  @Delete('papelera')
  @ApiOperation({ summary: 'Purga la papelera: borra los objetos que nadie más referencia' })
  @ApiOkResponse({ description: 'Cuántos nodos y objetos se borraron, y cuántos se conservaron.' })
  @NivelRequerido('administrar')
  async purgar(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(expedienteParamsSchema)) params: ExpedienteParamsDto,
    @Body(new ZodValidationPipe(purgarSchema)) body: PurgarDto,
    @Req() request: RequestConExpediente,
  ) {
    return this.expedientes.purgar({
      tenantId,
      expedienteId: params.id,
      actor: request.expediente!.actor,
      motivo: body.motivo,
      soloPapelera: true,
    });
  }
}
