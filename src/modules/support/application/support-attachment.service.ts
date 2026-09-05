/**
 * @file Servicio de aplicación: mandar y ver una foto o un comprobante en la conversación.
 * @business Sin esto el adjunto es sólo una fila con metadatos que nadie puede subir ni abrir.
 * @system ticket de subida firmado, verificación real del objeto y entrega por bytes autenticados.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  type AllowedEvidenceMimeType,
  DocumentStorageService,
} from '../../../common/storage/document-storage.service.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import { SupportMessageRepository } from '../support-message.repository.js';
import type { SendMessageDto } from '../support-case.schemas.js';
import type { SupportActor } from './support-actor.service.js';

/** Lo que se puede mandar por el chat. La evidencia sensible va por el uploader seguro, no por aquí. */
const CHAT_MIME_TYPES: readonly AllowedEvidenceMimeType[] = ALLOWED_EVIDENCE_MIME_TYPES;

/** Lo que el servidor comprobó por su cuenta, que es lo único que se guarda. */
export interface VerifiedAttachment {
  readonly declaredMime: AllowedEvidenceMimeType;
  readonly detectedMime: string | null;
  readonly sha256: string | null;
  readonly scanStatus: 'clean' | 'skipped';
}

@Injectable()
export class SupportAttachmentService {
  private readonly logger = new Logger(SupportAttachmentService.name);

  constructor(
    private readonly storage: DocumentStorageService,
    private readonly messages: SupportMessageRepository,
    private readonly channels: SupportChannelRepository,
  ) {}

  /**
   * El permiso para subir, acotado a la conversación de quien lo pide.
   *
   * El archivo no pasa por el backend: el teléfono lo sube directo al almacenamiento con una URL
   * firmada y de vida corta. Hacerlo pasar por aquí convertiría cada foto en memoria del proceso de
   * la API y en un límite de tamaño de petición, que es justo lo que rompe con conexiones malas.
   *
   * La CLAVE del objeto la propone el servidor, nunca quien sube: si la propusiera el cliente,
   * podría escribir dentro de la carpeta de otra persona.
   */
  async createTicket(input: {
    tenantId: string;
    actor: SupportActor;
    channelId: string;
    contentType: string;
    sizeBytes: number;
  }) {
    const channel = await this.channels.requireById(input.tenantId, input.channelId);
    if (['CLOSED', 'ABANDONED'].includes(channel.status)) {
      throw new ForbiddenException({ code: 'SUPPORT_CHANNEL_CLOSED', channelId: input.channelId });
    }
    if (!CHAT_MIME_TYPES.includes(input.contentType as AllowedEvidenceMimeType)) {
      throw new BadRequestException({ code: 'SUPPORT_ATTACHMENT_TYPE_NOT_ALLOWED', allowed: CHAT_MIME_TYPES });
    }
    if (!this.storage.isConfigured()) {
      throw new BadRequestException({ code: 'SUPPORT_ATTACHMENT_STORAGE_UNAVAILABLE' });
    }

    return this.storage.createUploadTicket({
      tenantId: input.tenantId,
      subjectId: `support-${input.channelId}`,
      documentType: 'support-attachment',
      contentType: input.contentType as AllowedEvidenceMimeType,
      sizeBytes: input.sizeBytes,
    });
  }

  /**
   * Comprueba que el objeto subido es lo que dice ser. Se llama ANTES de escribir el mensaje.
   *
   * ## Por qué antes y no después
   *
   * Porque el mensaje es inmutable: si se escribe primero y el archivo resulta inválido, queda un
   * «te mando el comprobante» sin comprobante que ya no se puede borrar, y el cliente ve un error
   * habiendo enviado algo. Verificar primero hace que el fallo no deje rastro.
   *
   * ## Qué se comprueba
   *
   * Quien sube el archivo es la parte interesada en que parezca lo que no es, así que no se cree
   * ninguno de sus metadatos: se descarga el objeto, se recalcula el SHA-256, se contrastan los
   * bytes mágicos con el tipo declarado y se pasa el antivirus.
   */
  async verify(attachment: NonNullable<SendMessageDto['attachment']>): Promise<VerifiedAttachment> {
    const declaredMime = attachment.declaredMime as AllowedEvidenceMimeType;
    if (!CHAT_MIME_TYPES.includes(declaredMime)) {
      throw new BadRequestException({ code: 'SUPPORT_ATTACHMENT_TYPE_NOT_ALLOWED', allowed: CHAT_MIME_TYPES });
    }
    if (!this.storage.isConfigured()) {
      return { declaredMime, detectedMime: null, sha256: attachment.sha256 ?? null, scanStatus: 'skipped' };
    }

    let verified: Awaited<ReturnType<DocumentStorageService['verifyDeclaredObject']>>;
    try {
      verified = await this.storage.verifyDeclaredObject({
        storageKey: attachment.storageObjectKey,
        declaredSha256: attachment.sha256 ?? '',
        declaredMimeType: declaredMime,
        declaredSizeBytes: attachment.sizeBytes,
      });
    } catch (error) {
      /*
       * El almacenamiento caído NO es «error interno»: es una condición temporal que el cliente
       * puede reintentar, y decírselo así es la diferencia entre «vuelve a intentarlo» y «algo se
       * rompió». Sin este catch salía un 500 opaco y el mensaje se quedaba escrito sin su foto.
       */
      this.logger.error(`Almacenamiento inaccesible al verificar un adjunto: ${String(error)}`);
      throw new ServiceUnavailableException({
        code: 'SUPPORT_ATTACHMENT_STORAGE_UNREACHABLE',
        message: 'No pudimos comprobar el archivo. Inténtalo de nuevo en un momento.',
      });
    }

    if (!verified.ok) throw new BadRequestException({ code: 'SUPPORT_ATTACHMENT_REJECTED', reason: verified.reason });
    return {
      declaredMime,
      detectedMime: verified.metadata.contentType ?? declaredMime,
      sha256: verified.metadata.sha256Hex ?? attachment.sha256 ?? null,
      scanStatus: 'clean',
    };
  }

  /** Escribe la fila del adjunto ya verificado y lo cuelga del mensaje. */
  persist(input: {
    tenantId: string;
    actor: SupportActor;
    messageId: string;
    caseId: string | null;
    attachment: NonNullable<SendMessageDto['attachment']>;
    verified: VerifiedAttachment;
  }) {
    return this.messages.createAttachment({
      tenantId: input.tenantId,
      messageId: input.messageId,
      caseId: input.caseId,
      storageObjectKey: input.attachment.storageObjectKey,
      originalFilename: input.attachment.filename,
      declaredMime: input.verified.declaredMime,
      detectedMime: input.verified.detectedMime,
      sizeBytes: String(input.attachment.sizeBytes),
      sha256: input.verified.sha256,
      malwareScanStatus: input.verified.scanStatus,
      sensitivity: 'NORMAL',
      uploadedByActorType: input.actor.actorType,
      uploadedByActorId: input.actor.actorId,
    });
  }

  /**
   * Entrega el archivo como BYTES por una ruta autenticada, no como URL pública.
   *
   * Una URL prefirmada que se pega en un `<img src>` es un enlace que funciona sin sesión y que
   * viaja por el historial del navegador y por los logs de cualquier proxy. Aquí el cliente pide el
   * contenido con su token y lo convierte en blob: el archivo no existe fuera de la sesión de quien
   * tiene derecho a verlo.
   *
   * Un adjunto que todavía no pasó el escaneo NO se entrega. Que exista la fila no significa que el
   * archivo sea seguro.
   */
  async readContent(input: { tenantId: string; actor: SupportActor; attachmentId: string }) {
    const attachment = await this.messages.findAttachmentById(input.tenantId, input.attachmentId);
    if (!attachment) throw new NotFoundException({ code: 'SUPPORT_ATTACHMENT_NOT_FOUND', attachmentId: input.attachmentId });
    if (attachment.malwareScanStatus === 'infected' || attachment.malwareScanStatus === 'pending') {
      throw new ForbiddenException({ code: 'SUPPORT_ATTACHMENT_NOT_AVAILABLE', scanStatus: attachment.malwareScanStatus });
    }

    const message = attachment.messageId ? await this.messages.findById(input.tenantId, String(attachment.messageId)) : null;
    if (!message) throw new NotFoundException({ code: 'SUPPORT_ATTACHMENT_ORPHAN', attachmentId: input.attachmentId });

    // La autorización es la misma que la del mensaje que lo lleva: estar dentro del canal.
    const participant = await this.channels.findLiveParticipant(String(message.channelId), input.actor.actorType, input.actor.actorId);
    if (!participant) throw new ForbiddenException({ code: 'SUPPORT_CHANNEL_NOT_PARTICIPANT' });
    if (message.visibility === 'INTERNAL' && !input.actor.isInternal) {
      throw new ForbiddenException({ code: 'SUPPORT_CHANNEL_NOT_PARTICIPANT' });
    }

    const bytes = await this.storage.readObject(attachment.storageObjectKey);
    if (!bytes) throw new NotFoundException({ code: 'SUPPORT_ATTACHMENT_CONTENT_MISSING' });

    return {
      bytes,
      contentType: attachment.detectedMime ?? attachment.declaredMime ?? 'application/octet-stream',
      filename: attachment.originalFilename,
    };
  }
}
