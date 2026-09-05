/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Repara los expedientes que faltan y limpia lo que ya no debe estar guardado.
 * @system dos trabajos idempotentes: relleno histórico y limpieza de papelera, tickets y retención.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { env } from '../../../config/env.js';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { ActorService } from '../application/actor.service.js';
import { ExpedienteService } from '../application/expediente.service.js';
import { MaterializadorService } from '../application/materializador.service.js';
import { NodoService } from '../application/nodo.service.js';
import { ObjectRefCounterService } from '../application/object-ref-counter.service.js';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import { ExpedienteAccesosRepository } from '../repositories/expediente-accesos.repository.js';
import { CARPETA_POR_TIPO, type ClaseNodo } from '../expedientes.types.js';

type FilaCliente = { customerId: string; tenantId: string; customerCode: string | null; lifecycleStatus: string | null };
type FilaEvidencia = {
  id: string;
  documentType: string | null;
  s3Key: string | null;
  s3Bucket: string | null;
  sha256: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
};

/**
 * Los dos trabajos de fondo del expediente.
 *
 * ## Relleno: por qué existe y por qué es idempotente
 *
 * El módulo nace con clientes que ya tienen documentos. Sin relleno, un revisor que abriera el caso
 * de alguien de la semana pasada vería una carpeta vacía y concluiría que no subió nada — la peor
 * lectura posible, porque es indistinguible de la verdad para quien no sabe cuándo se desplegó
 * esto. Corre por lotes y se puede lanzar tantas veces como haga falta: el expediente se crea si no
 * está, y cada archivo se registra sólo si su clave no figura ya.
 *
 * **No escribe manifiesto.** Un manifiesto es la foto de lo que había AL ENVIAR, y esa foto no se
 * observó: fabricarla ahora sería inventar evidencia con fecha falsa. Los expedientes rellenados
 * quedan sin él, y la pantalla lo dice.
 *
 * ## Limpieza: qué recoge
 *
 * Tickets de subida vencidos (con su objeto huérfano si llegó a escribirse), papelera pasada de
 * plazo y expedientes cuya retención venció. Es el único sitio del módulo que borra bytes sin que
 * una persona lo pida, y por eso pasa por el mismo conteo de referencias que la purga manual.
 */
@Injectable()
export class ExpedientesMantenimientoService {
  private readonly logger = new Logger(ExpedientesMantenimientoService.name);

  constructor(
    private readonly repository: ExpedientesRepository,
    private readonly accesos: ExpedienteAccesosRepository,
    private readonly expedientes: ExpedienteService,
    private readonly nodos: NodoService,
    private readonly materializador: MaterializadorService,
    private readonly refCounter: ObjectRefCounterService,
    private readonly storage: DocumentStorageService,
    private readonly actores: ActorService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /** Un lote de clientes sin expediente. Devuelve cuántos se crearon y cuántos nodos se añadieron. */
  async rellenar(limite = 200): Promise<{ clientes: number; nodos: number; sinObjeto: number }> {
    if (!env.EXPEDIENTES_ENABLED) return { clientes: 0, nodos: 0, sinObjeto: 0 };

    const clientes = await this.sequelize.query<FilaCliente>(
      `SELECT c._id::text AS "customerId", c._tenant_id::text AS "tenantId",
              c.customer_code AS "customerCode", c.lifecycle_status AS "lifecycleStatus"
         FROM ${atlasSchemaFor('customers')}.customers c
        WHERE NOT EXISTS (
                SELECT 1 FROM ${atlasSchemaFor('expedientes')}.expedientes e
                 WHERE e._tenant_id = c._tenant_id AND e.subject_type = 'customer' AND e.subject_id = c._id)
        ORDER BY c._id
        LIMIT :limite`,
      { replacements: { limite }, type: QueryTypes.SELECT },
    );

    const actor = this.actores.sistema();
    let nodos = 0;
    let sinObjeto = 0;

    for (const cliente of clientes) {
      const expediente = await this.expedientes.abrir({
        tenantId: cliente.tenantId,
        subjectType: 'customer',
        subjectId: cliente.customerId,
        // Sin sesión: el relleno no puede saber por cuál entró, y atarlo a una equivocada sería
        // peor que dejarlo nulo.
        sessionId: null,
        customerCode: cliente.customerCode,
        actor,
      });
      await this.materializador.asegurarNodoDeContactos({
        tenantId: cliente.tenantId,
        expedienteId: expediente.id,
        actor,
      });

      const evidencias = await this.sequelize.query<FilaEvidencia>(
        `SELECT _id::text AS id, document_type AS "documentType", s3_key AS "s3Key", s3_bucket AS "s3Bucket",
                file_hash_sha256 AS sha256, mime_type AS "mimeType", file_size_bytes::text AS "sizeBytes"
           FROM ${atlasSchemaFor('evidence_documents')}.evidence_documents
          WHERE _tenant_id = :tenantId AND customer_id = :customerId AND COALESCE(deleted, false) = false
          ORDER BY _id`,
        { replacements: { tenantId: cliente.tenantId, customerId: cliente.customerId }, type: QueryTypes.SELECT },
      );

      for (const evidencia of evidencias) {
        const resultado = await this.rellenarEvidencia(cliente.tenantId, expediente.id, evidencia);
        nodos += resultado.nodo;
        sinObjeto += resultado.sinObjeto;
      }

      // Un cliente que ya pasó del alta tiene su expediente cerrado, no abierto: dejarlo «abierto»
      // haría creer que sigue subiendo documentos.
      if (cliente.lifecycleStatus && !['draft', 'pending_documents', 'onboarding'].includes(cliente.lifecycleStatus)) {
        await this.repository.actualizarExpediente(cliente.tenantId, expediente.id, { estado: 'cerrado' });
      }
    }

    if (clientes.length > 0) {
      this.logger.log(`Relleno de expedientes: ${clientes.length} clientes, ${nodos} nodos, ${sinObjeto} sin objeto.`);
    }
    return { clientes: clientes.length, nodos, sinObjeto };
  }

  /**
   * Un documento de evidencia dentro del expediente, con su objeto comprobado.
   *
   * Se comprueba con un HEAD y no descargándolo: hay filas antiguas con `s3_bucket` nulo y objetos
   * que ya no están, y marcar la ausencia aquí es lo que permite que la pantalla diga «este archivo
   * se perdió» en vez de fallar al abrirlo — y que alguien pueda contar cuántos hay antes de que un
   * revisor se tropiece con el primero.
   */
  private async rellenarEvidencia(
    tenantId: string,
    expedienteId: string,
    evidencia: FilaEvidencia,
  ): Promise<{ nodo: number; sinObjeto: number }> {
    if (!evidencia.s3Key) return { nodo: 0, sinObjeto: 0 };

    const destino = CARPETA_POR_TIPO[evidencia.documentType ?? 'other'] ?? CARPETA_POR_TIPO.other;
    const mime = evidencia.mimeType ?? '';
    const extension = mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';

    const nodo = await this.nodos.registrarArchivo({
      tenantId,
      expedienteId,
      carpeta: destino.carpeta,
      nombre: `${destino.nombre}.${extension}`,
      origen: 'onboarding',
      clase: destino.clase as ClaseNodo,
      storageKey: evidencia.s3Key,
      storageBucket: evidencia.s3Bucket,
      sha256: evidencia.sha256,
      mimeType: evidencia.mimeType,
      sizeBytes: evidencia.sizeBytes,
      evidenceDocumentId: evidencia.id,
      actor: this.actores.sistema(),
    });
    if (!nodo) return { nodo: 0, sinObjeto: 0 };

    try {
      const cabecera = await this.storage.headObject(evidencia.s3Key);
      if (!cabecera) {
        await this.repository.actualizarNodo(tenantId, nodo.id, { objetoAusente: true });
        return { nodo: 1, sinObjeto: 1 };
      }
      if (!evidencia.s3Bucket) {
        await this.repository.actualizarNodo(tenantId, nodo.id, { storageBucket: this.storage.getBucket() });
      }
    } catch (error) {
      this.logger.warn(`No se pudo comprobar ${evidencia.s3Key}: ${(error as Error).message}`);
    }
    return { nodo: 1, sinObjeto: 0 };
  }

  async limpiar(): Promise<{ ticketsCaducados: number; nodosPurgados: number; expedientesPurgados: number }> {
    if (!env.EXPEDIENTES_ENABLED) return { ticketsCaducados: 0, nodosPurgados: 0, expedientesPurgados: 0 };
    const actor = this.actores.sistema();

    // 1. Tickets vencidos sin confirmar. El objeto pudo llegar a escribirse y nadie lo referencia.
    const tickets = await this.accesos.findTicketsVencidos(200);
    for (const ticket of tickets) {
      await this.storage.deleteObject(ticket.storageKey).catch(() => undefined);
      await this.accesos.borrarTicket(ticket.id);
    }

    // 2. Papelera pasada de plazo.
    const vencidos = await this.repository.findPapeleraVencida(env.EXPEDIENTES_TRASH_RETENTION_DAYS, 200);
    let nodosPurgados = 0;
    for (const nodo of vencidos) {
      if (nodo.storageKey && !nodo.virtual) {
        const referencias = await this.refCounter.contar(nodo.storageKey, nodo.id);
        // Ante la duda no se borra: se reintenta en la vuelta siguiente. Un huérfano cuesta unos
        // kilobytes; un hueco en la evidencia de una decisión no se repara.
        if (!this.refCounter.puedeBorrarse(referencias)) continue;
        await this.storage.deleteObject(nodo.storageKey).catch(() => undefined);
      }
      await this.repository.borrarNodoDefinitivo(nodo.tenantId, nodo.id);
      nodosPurgados += 1;
    }

    // 3. Expedientes cuya retención venció.
    const expedientes = await this.repository.findExpedientesVencidos(20);
    for (const expediente of expedientes) {
      await this.expedientes.purgar({
        tenantId: expediente.tenantId,
        expedienteId: expediente.id,
        actor,
        motivo: 'retencion_vencida',
        soloPapelera: false,
      });
    }

    if (tickets.length + nodosPurgados + expedientes.length > 0) {
      this.logger.log(
        `Limpieza de expedientes: ${tickets.length} tickets, ${nodosPurgados} nodos, ${expedientes.length} expedientes.`,
      );
    }
    return { ticketsCaducados: tickets.length, nodosPurgados, expedientesPurgados: expedientes.length };
  }
}
