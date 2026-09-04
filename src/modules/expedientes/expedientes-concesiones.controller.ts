/**
 * @file Controlador HTTP: traduce peticiones a casos de uso y respuestas tipadas.
 * @business Permite ampliar o retirar quién ve la carpeta de una persona, dejando dicho por qué.
 * @system expone conceder y revocar acceso sobre un nodo del expediente.
 */
import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ConcesionService } from './application/concesion.service.js';
import { NodoService } from './application/nodo.service.js';
import { ExpedienteAccesoGuard, NivelRequerido, type RequestConExpediente } from './guards/expediente-acceso.guard.js';
import {
  concederSchema,
  concesionParamsSchema,
  nodoParamsSchema,
  type ConcederDto,
  type ConcesionParamsDto,
  type NodoParamsDto,
} from './expedientes.schemas.js';

/**
 * Compartir una carpeta de evidencia.
 *
 * Va en su propio controlador y no junto a los nodos porque es la única familia de operaciones que
 * cambia QUIÉN puede ver datos de una persona, en vez de qué hay dentro. Tenerla separada hace que
 * su lista de roles y su nivel exigido se lean de un vistazo, en lugar de perderse entre catorce
 * endpoints de árbol.
 */
@ApiTags('Expedientes')
@ApiBearerAuth('access-token')
@Controller('expedientes/:id/nodos/:nodoId/concesiones')
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
@UseGuards(ExpedienteAccesoGuard)
export class ExpedientesConcesionesController {
  constructor(
    private readonly concesiones: ConcesionService,
    private readonly nodos: NodoService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Concede acceso a un rol o a una persona sobre este nodo' })
  @ApiOkResponse({ description: 'La concesión creada. Se hereda hacia los descendientes.' })
  @NivelRequerido('compartir')
  async conceder(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(nodoParamsSchema)) params: NodoParamsDto,
    @Body(new ZodValidationPipe(concederSchema)) body: ConcederDto,
    @Req() request: RequestConExpediente,
  ) {
    const nodo = await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId);
    const concesion = await this.concesiones.conceder({
      tenantId,
      expedienteId: params.id,
      nodoId: nodo.id,
      actor: request.expediente!.actor,
      nivelDelActor: request.expediente!.nivel,
      principalTipo: body.principalTipo,
      principalId: body.principalId,
      nivel: body.nivel,
      motivo: body.motivo,
      venceEn: body.venceEn ? new Date(body.venceEn) : null,
    });
    return {
      concesionId: concesion.id,
      principalTipo: concesion.principalTipo,
      principalId: concesion.principalId,
      nivel: concesion.nivel,
      venceEn: concesion.venceEn?.toISOString() ?? null,
    };
  }

  @Delete(':grantId')
  @ApiOperation({ summary: 'Revoca una concesión' })
  @ApiOkResponse({ description: 'Confirmación de la revocación.' })
  @NivelRequerido('compartir')
  async revocar(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(concesionParamsSchema)) params: ConcesionParamsDto,
    @Req() request: RequestConExpediente,
  ) {
    await this.concesiones.revocar({
      tenantId,
      expedienteId: params.id,
      nodoId: params.nodoId,
      concesionId: params.grantId,
      actor: request.expediente!.actor,
      nivelDelActor: request.expediente!.nivel,
    });
    return { revocada: true };
  }

  @Get()
  @ApiOperation({ summary: 'Quién tiene acceso a este nodo, y de dónde le viene' })
  @ApiOkResponse({ description: 'Concesiones directas y heredadas, con el nodo de origen.' })
  @NivelRequerido('compartir')
  async listarConcesiones(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(nodoParamsSchema)) params: NodoParamsDto,
  ) {
    const nodo = await this.nodos.obtenerNodo(tenantId, params.id, params.nodoId);
    return this.concesiones.listar(tenantId, params.id, nodo.id, nodo.ruta);
  }
}
