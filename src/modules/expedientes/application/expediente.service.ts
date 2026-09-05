/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Abre la carpeta de un alta, la congela cuando el cliente envía, y la purga cuando toca.
 * @system gobierna el ciclo de vida del expediente y la purga real de objetos del almacén.
 */
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import { NodoService } from './nodo.service.js';
import { ObjectRefCounterService } from './object-ref-counter.service.js';
import { CARPETAS_BASE, type ActorExpediente, type EstadoExpediente } from '../expedientes.types.js';
import type { ExpedienteModel } from '../../../database/models/index.js';

@Injectable()
export class ExpedienteService {
  private readonly logger = new Logger(ExpedienteService.name);

  constructor(
    private readonly repository: ExpedientesRepository,
    private readonly nodos: NodoService,
    private readonly storage: DocumentStorageService,
    private readonly refCounter: ObjectRefCounterService,
  ) {}

  habilitado(): boolean {
    return env.EXPEDIENTES_ENABLED;
  }

  private exigirHabilitado(): void {
    if (!this.habilitado()) throw new ServiceUnavailableException('EXPEDIENTES_DISABLED');
  }

  /**
   * Abre el expediente de un alta con sus cuatro carpetas.
   *
   * Idempotente por `(sujeto, sesión)`: el gancho del onboarding puede dispararse dos veces —un
   * reintento, un reproceso— y el cliente no debe acabar con dos carpetas medio llenas.
   *
   * Las carpetas se crean vacías desde el minuto uno, antes de que exista un solo archivo. Es
   * deliberado: un expediente que enseña «auth» y «extractos» vacíos dice qué falta; uno que sólo
   * enseña lo que ya llegó no distingue «no lo subió» de «no se pedía».
   */
  async abrir(input: {
    tenantId: string;
    subjectType: 'customer' | 'partner' | 'claim';
    subjectId: string;
    sessionId: string | null;
    customerCode: string | null;
    actor: ActorExpediente;
  }): Promise<ExpedienteModel> {
    const existente = await this.repository.findExpedientePorSujeto(
      input.tenantId,
      input.subjectType,
      input.subjectId,
      input.sessionId,
    );
    if (existente) return existente;

    const expediente = await this.repository.crearExpediente({
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      sessionId: input.sessionId,
      customerCode: input.customerCode,
      creadoPorTipo: input.actor.tipo,
      creadoPorId: input.actor.id,
    });

    for (const carpeta of CARPETAS_BASE) {
      await this.nodos.asegurarCarpeta({
        tenantId: input.tenantId,
        expedienteId: expediente.id,
        ruta: `/${carpeta.nombre}`,
        actor: input.actor,
      });
    }

    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: expediente.id,
      nodoId: null,
      accion: 'crear',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: { subjectType: input.subjectType, subjectId: input.subjectId, sessionId: input.sessionId },
    });
    return expediente;
  }

  async obtener(tenantId: string, expedienteId: string): Promise<ExpedienteModel> {
    this.exigirHabilitado();
    const expediente = await this.repository.findExpediente(tenantId, expedienteId);
    // 404 y no 403 cuando es de otro tenant: un 403 confirmaría que existe.
    if (!expediente) throw new NotFoundException('EXPEDIENTE_NO_ENCONTRADO');
    return expediente;
  }

  async porSujeto(
    tenantId: string,
    subjectType: string,
    subjectId: string,
    sessionId?: string | null,
  ): Promise<ExpedienteModel | null> {
    this.exigirHabilitado();
    return this.repository.findExpedientePorSujeto(tenantId, subjectType, subjectId, sessionId);
  }

  listar(input: { tenantId: string; subjectType?: string; estado?: EstadoExpediente; q?: string; offset: number; limit: number }) {
    this.exigirHabilitado();
    return this.repository.listarExpedientes(input);
  }

  /**
   * Congela el expediente: lo que había al enviar deja de poder tocarse.
   *
   * Es lo que hace CITABLE el manifiesto. Sin congelar, «esto es lo que el cliente envió» sería una
   * afirmación sobre una carpeta que cualquiera con permiso de escritura pudo cambiar después, y
   * entonces el manifiesto documentaría un momento que ya no se puede reconstruir.
   *
   * Lo que sigue permitido es AÑADIR en `otros/`: un revisor que consigue un papel más lo tiene que
   * poder guardar, y ese archivo se distingue del resto por no estar en el manifiesto.
   */
  async congelar(input: { tenantId: string; expedienteId: string; actor: ActorExpediente }): Promise<number> {
    const nodos = await this.repository.listarTodosLosNodos(input.tenantId, input.expedienteId);
    let congelados = 0;
    for (const nodo of nodos) {
      if (nodo.inmutable) continue;
      // La carpeta `otros` sigue abierta; su contenido de hoy sí se congela.
      if (nodo.ruta === '/otros') continue;
      await this.repository.actualizarNodo(input.tenantId, nodo.id, { inmutable: true });
      congelados += 1;
    }

    await this.repository.actualizarExpediente(input.tenantId, input.expedienteId, {
      estado: 'enviado',
      enviadoEn: new Date(),
    });
    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: null,
      accion: 'congelar',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: { nodosCongelados: congelados },
    });
    return congelados;
  }

  /**
   * Purga definitiva: borra filas y, cuando nadie más los referencia, los objetos.
   *
   * Es la operación que hace real el derecho de supresión, y la única del módulo que destruye
   * bytes. Por eso pregunta por cada clave antes de borrarla y se salta —sin fallar— las que el
   * conteo no puede garantizar.
   */
  async purgar(input: {
    tenantId: string;
    expedienteId: string;
    actor: ActorExpediente;
    motivo: string;
    soloPapelera: boolean;
  }): Promise<{ nodos: number; objetosBorrados: number; objetosConservados: number }> {
    const todos = await this.repository.listarTodosLosNodos(input.tenantId, input.expedienteId, true);
    const candidatos = input.soloPapelera ? todos.filter((nodo) => nodo.borradoEn !== null) : todos;

    let objetosBorrados = 0;
    let objetosConservados = 0;
    const conservadosPor: string[] = [];

    for (const nodo of candidatos) {
      if (nodo.storageKey) {
        const referencias = await this.refCounter.contar(nodo.storageKey, nodo.id);
        if (this.refCounter.puedeBorrarse(referencias)) {
          try {
            await this.storage.deleteObject(nodo.storageKey);
            objetosBorrados += 1;
          } catch (error) {
            this.logger.warn(`No se pudo borrar ${nodo.storageKey}: ${(error as Error).message}`);
            objetosConservados += 1;
          }
        } else {
          objetosConservados += 1;
          conservadosPor.push(nodo.ruta);
        }
      }
      await this.repository.borrarNodoDefinitivo(input.tenantId, nodo.id);
    }

    if (!input.soloPapelera) {
      await this.repository.actualizarExpediente(input.tenantId, input.expedienteId, {
        estado: 'purgado',
        purgadoEn: new Date(),
      });
    }

    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: null,
      accion: 'purgar',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: {
        motivo: input.motivo,
        soloPapelera: input.soloPapelera,
        nodos: candidatos.length,
        objetosBorrados,
        objetosConservados,
        objetoConservadoPor: conservadosPor.slice(0, 20),
      },
    });

    return { nodos: candidatos.length, objetosBorrados, objetosConservados };
  }

  /**
   * Purga por sujeto. Es la puerta que usa el flujo de supresión de datos personales.
   *
   * Existía un hueco medido: `customer-privacy` borraba las filas del cliente y **no tocaba el
   * almacén**, así que el carnet y la selfie de una persona suprimida seguían en el bucket. Sin
   * esto, el derecho de supresión no alcanzaba a la imagen del documento de identidad.
   */
  async purgarPorSujeto(input: {
    tenantId: string;
    subjectType: string;
    subjectId: string;
    actor: ActorExpediente;
    motivo: string;
  }): Promise<{ expedientes: number; objetosBorrados: number }> {
    if (!this.habilitado()) return { expedientes: 0, objetosBorrados: 0 };

    let expedientes = 0;
    let objetosBorrados = 0;
    // Un sujeto puede tener varios expedientes (un alta por sesión); se purgan todos.
    for (;;) {
      const expediente = await this.repository.findExpedientePorSujeto(input.tenantId, input.subjectType, input.subjectId);
      if (!expediente || expediente.purgadoEn) break;
      const resultado = await this.purgar({
        tenantId: input.tenantId,
        expedienteId: expediente.id,
        actor: input.actor,
        motivo: input.motivo,
        soloPapelera: false,
      });
      objetosBorrados += resultado.objetosBorrados;
      expedientes += 1;
      if (expedientes > 50) break;
    }
    return { expedientes, objetosBorrados };
  }
}
