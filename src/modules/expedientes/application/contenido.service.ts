/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Deja ver el carnet o el extracto a quien revisa, sin sacarlo del control del sistema.
 * @system entrega los bytes de un nodo por la API y registra cada acceso.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import type { ActorExpediente } from '../expedientes.types.js';
import type { ExpedienteNodoModel } from '../../../database/models/index.js';

/**
 * Los bytes, por la API y nunca por una URL prefirmada.
 *
 * ## Por qué no se entrega una URL firmada
 *
 * Sería más barato: el navegador iría directo a MinIO y el backend no movería el archivo. Y sería
 * peor. Una URL prefirmada es un permiso portátil: se pega en un chat, se guarda en un historial, y
 * sigue funcionando hasta que vence para cualquiera que la tenga. Aquí la autorización la impone
 * este proceso en cada petición, con el nivel efectivo del actor sobre ESE nodo, y cada acceso
 * queda en la bitácora con nombre y hora. Sobre la cara y el carnet de una persona, esa diferencia
 * es el producto.
 *
 * Es además lo que ya hacen el visor de evidencia (`customer-evidence-view.controller.ts`) y el
 * endpoint de imágenes del Motor; tres caminos distintos con la misma regla habrían sido tres
 * oportunidades de que uno la relajara.
 */
@Injectable()
export class ContenidoService {
  private readonly logger = new Logger(ContenidoService.name);

  constructor(
    private readonly storage: DocumentStorageService,
    private readonly repository: ExpedientesRepository,
  ) {}

  async leer(input: {
    tenantId: string;
    expedienteId: string;
    nodo: ExpedienteNodoModel;
    actor: ActorExpediente;
    descarga: boolean;
    ip?: string | null;
    requestId?: string | null;
  }): Promise<{ bytes: Buffer; contentType: string; nombre: string }> {
    if (input.nodo.tipo !== 'archivo' || !input.nodo.storageKey) {
      throw new NotFoundException('EXPEDIENTE_NODO_SIN_CONTENIDO');
    }

    const bytes = await this.storage.readObject(input.nodo.storageKey);
    if (!bytes) {
      /*
       * La fila existe y el objeto no.
       *
       * Se marca en el nodo en vez de dejarlo pasar como un 404 cualquiera: «este archivo nunca
       * estuvo» y «este archivo desapareció del almacén» llevan a acciones muy distintas, y la
       * segunda hay que poder verla en la pantalla sin abrir cada archivo para descubrirla.
       */
      await this.repository.actualizarNodo(input.tenantId, input.nodo.id, { objetoAusente: true });
      this.logger.warn(`El objeto ${input.nodo.storageKey} del nodo ${input.nodo.id} no está en el almacén.`);
      throw new NotFoundException('EXPEDIENTE_OBJETO_AUSENTE');
    }

    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: input.nodo.id,
      accion: input.descarga ? 'descargar' : 'ver',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
      detalle: { ruta: input.nodo.ruta, sha256: input.nodo.sha256 },
    });

    return {
      bytes,
      contentType: input.nodo.mimeType ?? 'application/octet-stream',
      nombre: input.nodo.nombre,
    };
  }
}
