/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Permite a quien revisa añadir un documento al expediente sin que pase por la API.
 * @system emite el ticket firmado, verifica lo subido y sólo entonces crea el nodo.
 */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { env } from '../../../config/env.js';
import { FileService } from '../../../common/files/file.service.js';
import { MinioFileStorageAdapter } from '../../../common/files/storage/minio-file-storage.adapter.js';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { extensionForContentType } from '../../../common/storage/storage-key.util.js';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import { ExpedienteAccesosRepository } from '../repositories/expediente-accesos.repository.js';
import { NodoService } from './nodo.service.js';
import type { ActorExpediente } from '../expedientes.types.js';

/**
 * La subida en dos tiempos: primero el permiso, después la comprobación.
 *
 * ## Por qué no un multipart contra la API
 *
 * Porque los bytes tendrían que atravesar el backend dos veces —entrar por HTTP y salir hacia el
 * almacén— y un extracto de 10 MB por cada operador que sube uno convierte la API en un proxy de
 * archivos. Con el ticket, el navegador escribe directo en MinIO y el backend sólo firma y verifica.
 *
 * ## Por qué se verifica DESPUÉS y no se confía
 *
 * El ticket firma `Content-Type` y `Content-Length`, así que el almacén ya rechaza lo que no
 * coincida con lo autorizado. Pero nadie ha mirado los BYTES: un PDF declarado puede ser un
 * ejecutable renombrado. Al confirmar, `FileService.verifyStored` descarga el objeto y comprueba
 * hash, tamaño, firma mágica y antivirus — el mismo camino y el mismo orden que la evidencia KYC.
 * Si falla, el objeto se borra: un archivo rechazado que se queda en el bucket es basura que nadie
 * va a encontrar.
 *
 * Es, además, el primer consumidor real de `common/files`: el servicio de archivos por adaptadores
 * existía completo y ningún módulo lo llamaba.
 */
@Injectable()
export class SubidaService {
  private readonly logger = new Logger(SubidaService.name);

  constructor(
    private readonly repository: ExpedientesRepository,
    private readonly accesos: ExpedienteAccesosRepository,
    private readonly nodos: NodoService,
    private readonly files: FileService,
    private readonly minio: MinioFileStorageAdapter,
    private readonly storage: DocumentStorageService,
  ) {}

  async emitirTicket(input: {
    tenantId: string;
    expedienteId: string;
    parentId: string | null;
    nombre: string;
    contentType: string;
    sizeBytes: number;
    sha256?: string | null;
    actor: ActorExpediente;
  }) {
    const nombre = this.nodos.validarNombre(input.nombre);
    if (input.sizeBytes <= 0 || input.sizeBytes > env.FILE_UPLOAD_MAX_BYTES) {
      throw new BadRequestException('FILE_TOO_LARGE');
    }
    if (!env.FILE_UPLOAD_ALLOWED_MIME_TYPES.split(',').map((tipo) => tipo.trim()).includes(input.contentType)) {
      throw new BadRequestException('FILE_CONTENT_TYPE_NOT_ALLOWED');
    }

    /*
     * La clave la construye el ADAPTADOR, no este servicio.
     *
     * Se intentó calcularla aquí para meterle el prefijo del módulo, y era un defecto en potencia:
     * el ticket se firma sobre la clave del adaptador, así que una clave propia se habría guardado
     * en el catálogo mientras los bytes acababan en otra. Firmar una y registrar otra deja el
     * objeto huérfano y el nodo apuntando al vacío.
     */
    const ticketDeAlmacen = this.minio.createUploadTicket({
      scope: { tenantId: input.tenantId, ownerId: input.expedienteId, category: 'expediente' },
      contentType: input.contentType,
      extension: extensionForContentType(input.contentType),
      sizeBytes: input.sizeBytes,
    });

    const venceEn = new Date(Date.now() + env.EXPEDIENTES_UPLOAD_TICKET_TTL_SECONDS * 1000);
    const ticket = await this.accesos.crearTicket({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      parentId: input.parentId,
      nombrePrevisto: nombre,
      mimeType: input.contentType,
      sizeBytes: String(input.sizeBytes),
      sha256Declarado: input.sha256 ?? null,
      storageKey: ticketDeAlmacen.storageKey,
      emitidoPorId: input.actor.id,
      venceEn,
    });

    return {
      ticketId: ticket.id,
      uploadUrl: ticketDeAlmacen.uploadUrl,
      method: ticketDeAlmacen.method,
      requiredHeaders: ticketDeAlmacen.requiredHeaders,
      // La clave NO viaja: quien sube no necesita saber dónde acaba el objeto, y publicarla
      // invitaría a construir rutas a mano contra el almacén.
      expiresAt: venceEn.toISOString(),
    };
  }

  async confirmar(input: { tenantId: string; expedienteId: string; ticketId: string; actor: ActorExpediente }) {
    const ticket = await this.accesos.findTicket(input.tenantId, input.ticketId);
    if (!ticket || ticket.expedienteId !== input.expedienteId) throw new NotFoundException('EXPEDIENTE_TICKET_NO_ENCONTRADO');
    if (ticket.consumidoEn) throw new ConflictException('EXPEDIENTE_TICKET_YA_CONSUMIDO');
    if (ticket.venceEn.getTime() < Date.now()) throw new ConflictException('EXPEDIENTE_TICKET_VENCIDO');

    const verificacion = await this.files.verifyStored({
      storageKey: ticket.storageKey,
      declaredSha256: ticket.sha256Declarado ?? '',
      declaredMimeType: ticket.mimeType,
      declaredSizeBytes: Number(ticket.sizeBytes),
    });

    if (!verificacion.ok) {
      /*
       * Rechazado: se borra el objeto antes de responder.
       *
       * Dejarlo sería acumular en el bucket exactamente lo que se decidió no aceptar —un archivo
       * con el hash cambiado, o uno que el antivirus marcó— sin ninguna fila que lo referencie y,
       * por tanto, sin forma de encontrarlo después.
       */
      await this.storage.deleteObject(ticket.storageKey).catch(() => undefined);
      await this.accesos.consumirTicket(input.tenantId, ticket.id);
      throw new BadRequestException(verificacion.reason);
    }

    await this.accesos.consumirTicket(input.tenantId, ticket.id);

    const carpeta = ticket.parentId
      ? await this.nodos.obtenerNodo(input.tenantId, input.expedienteId, ticket.parentId)
      : null;

    const nodo = await this.nodos.registrarArchivo({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      carpeta: carpeta ? carpeta.ruta.replace(/^\//, '') : 'otros',
      nombre: ticket.nombrePrevisto,
      origen: 'portal',
      clase: 'otro',
      storageKey: ticket.storageKey,
      storageBucket: this.storage.getBucket(),
      sha256: verificacion.value.sha256Hex,
      mimeType: verificacion.value.contentType,
      sizeBytes: String(verificacion.value.sizeBytes),
      actor: input.actor,
    });

    if (!nodo) throw new ConflictException('EXPEDIENTE_ARCHIVO_DUPLICADO');
    return nodo;
  }

  /**
   * Escribe un objeto desde el propio backend y crea su nodo.
   *
   * Es la vía del materializador (`contactos.json`, `manifest.json`…): no hay navegador que suba
   * nada, los bytes los produce el servidor. No pasa por `FileService.verify` porque el contenido
   * es JSON generado aquí mismo — verificar la firma mágica de un archivo que uno acaba de escribir
   * comprueba el propio código, no una entrada de fuera.
   */
  async escribirDesdeElServidor(input: {
    tenantId: string;
    expedienteId: string;
    carpeta: string;
    nombre: string;
    contenido: Buffer;
    contentType: string;
    clase: 'contactos' | 'consentimientos' | 'manifest' | 'verificacion' | 'analisis';
    actor: ActorExpediente;
  }) {
    const escrito = await this.minio.write(
      { tenantId: input.tenantId, ownerId: input.expedienteId, category: input.clase },
      {
        content: input.contenido,
        contentType: input.contentType,
        sizeBytes: input.contenido.byteLength,
        // El hash se calcula aquí y no se deja vacío: es lo que después permite comprobar que el
        // `manifest.json` que alguien cita es el que se escribió al enviar.
        sha256Hex: createHash('sha256').update(input.contenido).digest('hex'),
        extension: extensionForContentType(input.contentType),
      },
    );

    /*
     * Un archivo generado se REEMPLAZA, no se acumula.
     *
     * `contactos.json` se regenera cada vez que cambian los contactos; sin esto, un expediente
     * acabaría con «contactos.json», «contactos (1).json»… y nadie sabría cuál mirar. El nodo
     * anterior se borra a la papelera, así que la versión vieja sigue recuperable 90 días.
     */
    const previos = await this.repository.listarTodosLosNodos(input.tenantId, input.expedienteId);
    const anterior = previos.find((nodo) => nodo.clase === input.clase && !nodo.borradoEn);
    if (anterior && !anterior.inmutable) {
      await this.repository.actualizarNodo(input.tenantId, anterior.id, { borradoEn: new Date(), borradoPorId: null });
    }

    return this.nodos.registrarArchivo({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      carpeta: input.carpeta,
      nombre: input.nombre,
      origen: 'sistema',
      clase: input.clase,
      storageKey: escrito.storageKey,
      storageBucket: this.storage.getBucket(),
      sha256: escrito.sha256Hex,
      mimeType: escrito.contentType,
      sizeBytes: String(escrito.sizeBytes),
      actor: input.actor,
    });
  }
}
