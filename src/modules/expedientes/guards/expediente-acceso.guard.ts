/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Impide que alguien abra la carpeta de una persona sobre la que no tiene por qué mirar.
 * @system resuelve el nivel efectivo sobre el nodo pedido antes de que el controlador se ejecute.
 */
import { CanActivate, ExecutionContext, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolveCurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import type { RequestWithAuth } from '../../../common/types/auth.types.js';
import { ActorService } from '../application/actor.service.js';
import { ConcesionService } from '../application/concesion.service.js';
import { ExpedienteService } from '../application/expediente.service.js';
import { NodoService } from '../application/nodo.service.js';
import type { ActorExpediente, Nivel } from '../expedientes.types.js';

export const NIVEL_KEY = 'expediente_nivel';

/** El nivel que exige un endpoint. Sin él, el guard no interviene. */
export const NivelRequerido = (nivel: Nivel): ReturnType<typeof SetMetadata> => SetMetadata(NIVEL_KEY, nivel);

/** Lo que el guard deja en la petición para que el controlador no vuelva a resolverlo. */
export type ContextoExpediente = {
  actor: ActorExpediente;
  nivel: Nivel;
  expedienteId: string;
  nodoId: string | null;
};

export type RequestConExpediente = RequestWithAuth & {
  params?: Record<string, string>;
  expediente?: ContextoExpediente;
};

/**
 * La autorización por CARPETA, que `@Roles(...)` no sabe expresar.
 *
 * `RolesGuard` responde «¿puede esta persona usar este endpoint?» y es la primera puerta, que sigue
 * puesta. Este guard responde la segunda, que es la que importa en un explorador de archivos:
 * «¿puede ver ESTE expediente, y con qué alcance?». Sin él, cualquiera que pudiera abrir la pantalla
 * vería la carpeta de cualquier cliente del tenant.
 *
 * ## Por qué 404 y no 403 cuando el expediente es de otro tenant
 *
 * Un 403 confirma que el recurso existe. Sobre expedientes de personas, eso ya es información: dice
 * que ese cliente tiene un alta en Atlas. El 404 no distingue «no existe» de «no es tuyo», que es
 * justamente lo que no debe poder averiguarse desde fuera. Es el mismo criterio que ya aplican
 * `getRun` del Motor y `getInvestigationSummary`.
 */
@Injectable()
export class ExpedienteAccesoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly actores: ActorService,
    private readonly expedientes: ExpedienteService,
    private readonly nodos: NodoService,
    private readonly concesiones: ConcesionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requerido = this.reflector.getAllAndOverride<Nivel | undefined>(NIVEL_KEY, [context.getHandler(), context.getClass()]);
    if (!requerido) return true;

    const request = context.switchToHttp().getRequest<RequestConExpediente>();
    const tenantId = resolveCurrentTenant(request);
    const actor = await this.actores.resolver(request.user);

    const expedienteId = request.params?.id ?? request.params?.expedienteId;
    if (!expedienteId) {
      // Endpoints de listado: no hay expediente concreto, basta el suelo por rol. El filtrado a lo
      // que cada quien puede ver lo hace el servicio, no el guard.
      this.concesiones.exigir(this.concesiones.nivelBase(actor), requerido);
      request.expediente = { actor, nivel: requerido, expedienteId: '', nodoId: null };
      return true;
    }

    const nodoId = request.params?.nodoId ?? null;
    const nivel = await this.resolverNivel(tenantId, expedienteId, nodoId, actor);

    // Sin ningún nivel no se dice «prohibido»: se dice que no está, por lo de arriba.
    if (!nivel) throw new NotFoundException('EXPEDIENTE_NO_ENCONTRADO');
    this.concesiones.exigir(nivel, requerido);

    request.expediente = { actor, nivel, expedienteId, nodoId };
    return true;
  }

  /** El nivel sobre el nodo pedido, o sobre la raíz del expediente si el endpoint no nombra uno. */
  private async resolverNivel(
    tenantId: string,
    expedienteId: string,
    nodoId: string | null,
    actor: ActorExpediente,
  ): Promise<Nivel | null> {
    const expediente = await this.expedientes.obtener(tenantId, expedienteId);
    const nodo = nodoId ? await this.nodos.obtenerNodo(tenantId, expedienteId, nodoId) : null;
    return this.concesiones.resolver({
      tenantId,
      expedienteId,
      actor,
      nodoId: nodo?.id ?? null,
      ruta: nodo?.ruta ?? '',
      congelado: nodo?.inmutable ?? false,
      expedientePurgado: expediente.purgadoEn !== null,
    });
  }
}
