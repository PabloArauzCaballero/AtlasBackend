/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Deja constancia de qué había en el expediente el día que el cliente pulsó enviar.
 * @system escribe el manifiesto firmado; el resto de lo derivado se sirve desde la base.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { env } from '../../../config/env.js';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import { SubidaService } from './subida.service.js';
import type { ActorExpediente } from '../expedientes.types.js';

/**
 * El manifiesto: el inventario firmado de lo que había al enviar.
 *
 * ## Por qué ESTE sí es un objeto y los contactos no
 *
 * Porque su valor está justamente en NO cambiar. Un revisor que meses después discute una decisión
 * necesita poder decir «esto es lo que el cliente envió», y eso exige una foto congelada y
 * verificable, no una consulta que devuelve el estado de hoy. Los contactos son lo contrario: se
 * quieren siempre vigentes, y por eso se componen desde la base en cada petición.
 *
 * ## Por qué va firmado
 *
 * El HMAC no protege contra quien tenga la clave; protege contra el cambio silencioso. Si alguien
 * edita el JSON en el bucket, la firma deja de cuadrar y el expediente lo dice. Sin firma, un
 * manifiesto alterado es indistinguible de uno legítimo, y entonces no sirve para lo único que hace.
 */
@Injectable()
export class MaterializadorService {
  private readonly logger = new Logger(MaterializadorService.name);

  constructor(
    private readonly repository: ExpedientesRepository,
    private readonly subidas: SubidaService,
  ) {}

  /**
   * La clave con la que se firma.
   *
   * Se reutiliza `FILE_STORAGE_LOCAL_URL_SECRET` porque existe para exactamente esto —firmar algo
   * que el propio backend emite y después verifica— y `env-cross-checks` ya exige que en producción
   * tenga longitud mínima y sea distinta de la de JWT. Añadir una variable más habría duplicado esa
   * comprobación en otro sitio.
   */
  private clave(): string | null {
    return env.FILE_STORAGE_LOCAL_URL_SECRET?.trim() || null;
  }

  firmar(contenido: string): string | null {
    const clave = this.clave();
    if (!clave) return null;
    return createHmac('sha256', clave).update(contenido, 'utf8').digest('hex');
  }

  /** `true` si el manifiesto no ha cambiado desde que se escribió. */
  verificar(contenido: string, firma: string | null): boolean {
    if (!firma) return false;
    return this.firmar(contenido) === firma;
  }

  async escribirManifiesto(input: { tenantId: string; expedienteId: string; actor: ActorExpediente }) {
    const nodos = await this.repository.listarTodosLosNodos(input.tenantId, input.expedienteId);
    const archivos = nodos
      .filter((nodo) => nodo.tipo === 'archivo' && nodo.clase !== 'manifest')
      .map((nodo) => ({
        ruta: nodo.ruta,
        clase: nodo.clase,
        origen: nodo.origen,
        mimeType: nodo.mimeType,
        sizeBytes: nodo.sizeBytes,
        sha256: nodo.sha256,
        virtual: nodo.virtual,
        creadoEn: nodo.createdAtValue.toISOString(),
      }));

    const cuerpo = {
      version: 1,
      expedienteId: input.expedienteId,
      generadoEn: new Date().toISOString(),
      archivos,
      // El resumen de los resúmenes: una sola cadena que cambia si cambia cualquier archivo. Es lo
      // que permite comparar dos manifiestos sin recorrer las dos listas.
      huellaDelConjunto: createHash('sha256')
        .update(archivos.map((archivo) => `${archivo.ruta}:${archivo.sha256 ?? ''}`).join('\n'), 'utf8')
        .digest('hex'),
    };

    const serializado = JSON.stringify(cuerpo, null, 2);
    const firma = this.firmar(serializado);
    if (!firma) {
      // Sin secreto se escribe igual, pero se dice: un manifiesto sin firma sigue siendo un
      // inventario útil; lo que pierde es la capacidad de demostrar que no lo tocaron.
      this.logger.warn('El manifiesto se escribe SIN firma: falta FILE_STORAGE_LOCAL_URL_SECRET.');
    }

    const contenido = Buffer.from(`${JSON.stringify({ ...cuerpo, firma }, null, 2)}\n`, 'utf8');
    const nodo = await this.subidas.escribirDesdeElServidor({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      carpeta: '',
      nombre: 'manifest.json',
      contenido,
      contentType: 'application/json',
      clase: 'manifest',
      actor: input.actor,
    });

    if (nodo) {
      await this.repository.actualizarExpediente(input.tenantId, input.expedienteId, { manifestNodoId: nodo.id });
      await this.repository.actualizarNodo(input.tenantId, nodo.id, { inmutable: true });
    }
    return nodo;
  }

  /**
   * Crea el nodo VIRTUAL de contactos, si no existe.
   *
   * No escribe bytes: es una fila que hace visible en la carpeta algo que se compone desde la base
   * al abrirlo. Sin ella, «el JSON de contactos» sería un endpoint que hay que conocer; con ella,
   * es un archivo que está donde uno lo busca.
   */
  async asegurarNodoDeContactos(input: { tenantId: string; expedienteId: string; actor: ActorExpediente }) {
    const nodos = await this.repository.listarTodosLosNodos(input.tenantId, input.expedienteId);
    if (nodos.some((nodo) => nodo.clase === 'contactos' && !nodo.borradoEn)) return null;

    return this.repository.crearNodo({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      parentId: null,
      tipo: 'archivo',
      nombre: 'contactos.json',
      ruta: '/contactos.json',
      origen: 'sistema',
      clase: 'contactos',
      virtual: true,
      mimeType: 'application/json',
      creadoPorTipo: input.actor.tipo,
      creadoPorId: input.actor.id,
    });
  }
}
