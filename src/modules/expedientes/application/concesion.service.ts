/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Decide quién puede ver o tocar la carpeta de una persona, y deja constancia de por qué.
 * @system resuelve el nivel efectivo sobre un nodo combinando permisos de rol y concesiones heredadas.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import { ExpedienteAccesosRepository } from '../repositories/expediente-accesos.repository.js';
import { alcanza, nivelMayor, type ActorExpediente, type Nivel } from '../expedientes.types.js';

/**
 * El nivel base que da cada permiso del catálogo RBAC.
 *
 * Es el suelo: lo que un rol puede hacer sobre CUALQUIER expediente del tenant sin que nadie le
 * conceda nada. Las concesiones suben desde aquí, nunca bajan — un permiso que quitara acceso
 * sería invisible para quien lo tiene y ya vio el archivo.
 */
const NIVEL_POR_PERMISO: ReadonlyArray<{ permiso: string; nivel: Nivel }> = [
  { permiso: 'expedientes.leer', nivel: 'leer' },
  { permiso: 'expedientes.escribir', nivel: 'escribir' },
  { permiso: 'expedientes.compartir', nivel: 'compartir' },
  { permiso: 'expedientes.administrar', nivel: 'administrar' },
];

/**
 * La autorización de un explorador de archivos, que un rol no sabe expresar.
 *
 * ## Por qué hacía falta una capa nueva
 *
 * El backend autoriza con `@Roles(...)`: una lista de roles por endpoint. Eso responde «¿puede esta
 * persona usar esta función?» y no puede responder «¿puede ver ESTA carpeta?». Con una sola
 * pantalla de archivos para todos los expedientes del tenant, la segunda es la pregunta que importa:
 * un analista de cobranzas y uno de fraude usan el mismo endpoint y no deben ver lo mismo.
 *
 * ## Cómo se resuelve
 *
 * El nivel efectivo es el MAYOR de tres cosas, y ninguna resta:
 *  1. el suelo que da el rol por catálogo,
 *  2. la concesión heredada más alta entre el nodo y sus ancestros,
 *  3. la concesión directa al usuario.
 *
 * Y después se recorta por dos techos que ningún permiso levanta: un nodo congelado no admite
 * escritura, y un expediente purgado sólo admite mirar su bitácora.
 */
@Injectable()
export class ConcesionService {
  constructor(
    private readonly repository: ExpedientesRepository,
    private readonly accesos: ExpedienteAccesosRepository,
  ) {}

  /** El suelo por rol. Sin ningún permiso de expedientes, `null`: no ve nada. */
  nivelBase(actor: ActorExpediente): Nivel | null {
    let nivel: Nivel | null = null;
    for (const entrada of NIVEL_POR_PERMISO) {
      if (actor.permisos.includes(entrada.permiso)) nivel = nivelMayor(nivel, entrada.nivel);
    }
    return nivel;
  }

  /**
   * El nivel efectivo sobre un nodo concreto.
   *
   * `ruta` vacía significa la raíz del expediente: se resuelven las concesiones puestas sobre la
   * raíz, que son las que cubren el expediente entero.
   */
  async resolver(input: {
    tenantId: string;
    expedienteId: string;
    actor: ActorExpediente;
    nodoId?: string | null;
    ruta?: string;
    congelado?: boolean;
    expedientePurgado?: boolean;
  }): Promise<Nivel | null> {
    let nivel = this.nivelBase(input.actor);

    // Las concesiones se buscan sobre el nodo y todos sus ancestros a la vez.
    const ancestros = input.ruta !== undefined ? await this.repository.findAncestros(input.tenantId, input.expedienteId, input.ruta) : [];
    const nodoIds = [...ancestros.map((nodo) => nodo.id), ...(input.nodoId ? [input.nodoId] : [])];
    const concesiones = await this.accesos.findConcesionesVigentes(input.tenantId, [...new Set(nodoIds)]);

    for (const concesion of concesiones) {
      const aplica =
        (concesion.principalTipo === 'usuario_interno' && concesion.principalId === input.actor.id) ||
        (concesion.principalTipo === 'rol' && input.actor.roles.includes(concesion.principalId));
      if (aplica) nivel = nivelMayor(nivel, concesion.nivel as Nivel);
    }

    if (!nivel) return null;

    /*
     * Los dos techos.
     *
     * Un expediente purgado conserva su bitácora precisamente para poder responder qué pasó con él;
     * dejar escribir encima sería poder alterar esa respuesta. Y un nodo congelado es lo que hace
     * citable el manifiesto: si se pudiera renombrar después del envío, «esto es lo que había»
     * dejaría de ser cierto.
     */
    if (input.expedientePurgado) return 'leer';
    if (input.congelado && alcanza(nivel, 'escribir')) return nivelMayor('leer', null) as Nivel;
    return nivel;
  }

  /** Lanza si el actor no alcanza el nivel. 403 con código estable; el 404 lo decide quien llama. */
  exigir(nivel: Nivel | null, requerido: Nivel): void {
    if (!alcanza(nivel, requerido)) {
      throw new ForbiddenException('EXPEDIENTE_NIVEL_INSUFICIENTE');
    }
  }

  /**
   * Concede acceso. Dos reglas que el catálogo no puede imponer solo.
   *
   * No se puede dar más de lo que se tiene —si no, `compartir` sería `administrar` con un paso
   * más— y `administrar` sólo lo concede quien ya administra. El motivo es obligatorio porque
   * ampliar quién ve la evidencia de una persona es una decisión sobre datos de un tercero.
   */
  async conceder(input: {
    tenantId: string;
    expedienteId: string;
    nodoId: string;
    actor: ActorExpediente;
    nivelDelActor: Nivel | null;
    principalTipo: 'rol' | 'usuario_interno';
    principalId: string;
    nivel: Nivel;
    motivo: string;
    venceEn: Date | null;
  }) {
    this.exigir(input.nivelDelActor, 'compartir');
    if (!alcanza(input.nivelDelActor, input.nivel)) {
      throw new ForbiddenException('EXPEDIENTE_NIVEL_SUPERIOR_AL_PROPIO');
    }
    if (input.nivel === 'administrar') this.exigir(input.nivelDelActor, 'administrar');
    if (input.motivo.trim().length < 8) {
      throw new BadRequestException('EXPEDIENTE_MOTIVO_REQUERIDO');
    }

    const concesion = await this.accesos.crearConcesion({
      tenantId: input.tenantId,
      nodoId: input.nodoId,
      principalTipo: input.principalTipo,
      principalId: input.principalId,
      nivel: input.nivel,
      otorgadoPorId: input.actor.id,
      motivo: input.motivo.trim(),
      venceEn: input.venceEn,
    });

    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: input.nodoId,
      accion: 'compartir',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: { principalTipo: input.principalTipo, principalId: input.principalId, nivel: input.nivel, motivo: input.motivo.trim() },
    });

    return concesion;
  }

  async revocar(input: {
    tenantId: string;
    expedienteId: string;
    nodoId: string;
    concesionId: string;
    actor: ActorExpediente;
    nivelDelActor: Nivel | null;
  }): Promise<void> {
    this.exigir(input.nivelDelActor, 'compartir');
    const concesion = await this.accesos.findConcesion(input.tenantId, input.concesionId);
    if (!concesion || concesion.nodoId !== input.nodoId) throw new NotFoundException('EXPEDIENTE_CONCESION_NO_ENCONTRADA');
    if (concesion.revocadoEn) throw new ConflictException('EXPEDIENTE_CONCESION_YA_REVOCADA');

    /*
     * Nadie se quita a sí mismo la última administración.
     *
     * Sin esta guarda, un expediente puede quedar sin nadie que pueda purgarlo ni volver a conceder
     * acceso, y recuperarlo exige tocar la base a mano. Es la misma razón por la que una consola de
     * nube no deja borrar la última política de administrador.
     */
    if (
      concesion.nivel === 'administrar' &&
      concesion.principalTipo === 'usuario_interno' &&
      concesion.principalId === input.actor.id
    ) {
      throw new ConflictException('EXPEDIENTE_ULTIMA_ADMINISTRACION');
    }

    await this.accesos.revocarConcesion(input.tenantId, input.concesionId, input.actor.id);
    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: input.nodoId,
      accion: 'revocar',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: { principalTipo: concesion.principalTipo, principalId: concesion.principalId, nivel: concesion.nivel },
    });
  }

  /** Concesiones que afectan a un nodo, marcando cuáles vienen heredadas y de dónde. */
  async listar(tenantId: string, expedienteId: string, nodoId: string, ruta: string) {
    const ancestros = await this.repository.findAncestros(tenantId, expedienteId, ruta);
    const porNodo = new Map(ancestros.map((nodo) => [nodo.id, nodo.ruta || '/']));
    const concesiones = await this.accesos.findConcesionesVigentes(tenantId, [...porNodo.keys(), nodoId]);
    return concesiones.map((concesion) => ({
      id: concesion.id,
      principalTipo: concesion.principalTipo,
      principalId: concesion.principalId,
      nivel: concesion.nivel as Nivel,
      motivo: concesion.motivo,
      venceEn: concesion.venceEn?.toISOString() ?? null,
      otorgadaEn: concesion.createdAtValue.toISOString(),
      heredadaDe: concesion.nodoId === nodoId ? null : (porNodo.get(concesion.nodoId) ?? null),
    }));
  }
}
