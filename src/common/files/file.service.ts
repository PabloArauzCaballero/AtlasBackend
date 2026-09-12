/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system verifica todo archivo antes de persistirlo y delega el destino en el adaptador activo.
 */
import { BadRequestException, Injectable, Logger, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MalwareScannerService } from '../storage/malware-scanner.service.js';
import { FileAdapterConfigService } from './file-adapter-config.service.js';
import { FileAdapterRegistry } from './file-adapter.registry.js';
import { extensionForMimeType, isKnownFileMimeType, matchesFileMagicBytes } from './file-content-type.util.js';
import type {
  FileRejectionReason,
  FileScope,
  FileUploadTicket,
  FileVerificationResult,
  IncomingFile,
  StoredFileContent,
  StoredFileRef,
  VerifiedFile,
} from './file-storage.types.js';

/**
 * Servicio central de archivos.
 *
 * Aquí —y no en los adaptadores— viven TODAS las comprobaciones: tamaño, allowlist de tipo, firma
 * mágica, hash y antimalware. Es lo que garantiza que un archivo que entra por multipart reciba
 * exactamente el mismo trato que uno subido con un ticket firmado, y que añadir Cloudinary no
 * abra por descuido una vía sin verificar.
 *
 * El orden de las comprobaciones no es casual: primero las baratas y locales, el antimalware al
 * final, porque es la más cara y no tiene sentido pagarla por un archivo que ya falló el tipo.
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly registry: FileAdapterRegistry,
    private readonly config: FileAdapterConfigService,
    private readonly malwareScanner: MalwareScannerService,
  ) {}

  /** Traduce el objeto nativo de la vía de ingesta activa (hoy, el `file` de multer). */
  normalizeIncoming(raw: unknown): IncomingFile {
    return this.registry.resolveIngest().normalize(raw);
  }

  normalizeIncomingMany(raw: unknown): IncomingFile[] {
    return this.registry.resolveIngest().normalizeMany(raw);
  }

  /**
   * Verifica el archivo y, si supera todo, lo persiste en el adaptador activo.
   *
   * Devuelve una unión discriminada en vez de lanzar: quien llama decide si un rechazo es un 400,
   * un 422 o una entrada de auditoría. `storeOrThrow` cubre el caso HTTP habitual.
   */
  async store(scope: FileScope, incoming: IncomingFile): Promise<FileVerificationResult<StoredFileRef>> {
    const verification = await this.verify(incoming);
    if (!verification.ok) {
      // Se registra el MOTIVO y el ámbito, nunca el nombre del archivo ni sus bytes: en un backend
      // KYC el nombre que envía el cliente es PII.
      this.logger.warn(`Archivo rechazado (${verification.reason}) para ${scope.tenantId}/${scope.category}.`);
      return verification;
    }

    const stored = await this.registry.resolveStorage().write(scope, verification.value);
    return { ok: true, value: stored };
  }

  /** Variante para controladores: traduce cada motivo de rechazo a su excepción HTTP. */
  async storeOrThrow(scope: FileScope, incoming: IncomingFile): Promise<StoredFileRef> {
    const result = await this.store(scope, incoming);
    if (result.ok) return result.value;
    throw this.toHttpException(result.reason);
  }

  /**
   * Comprobaciones sobre los bytes reales. Separada de `store` para poder ejercitarla —y para poder
   * reutilizarla al verificar un objeto que subió el cliente con un ticket firmado, donde el backend
   * no vio pasar los bytes.
   */
  async verify(incoming: IncomingFile): Promise<FileVerificationResult<VerifiedFile>> {
    if (incoming.sizeBytes === 0 || incoming.content.byteLength === 0) {
      return { ok: false, reason: 'FILE_EMPTY' };
    }
    if (incoming.content.byteLength > this.config.getMaxBytes()) {
      return { ok: false, reason: 'FILE_TOO_LARGE' };
    }

    const declaredType = incoming.declaredMimeType.toLowerCase().trim();
    const allowed = this.config.getAllowedMimeTypes();
    if (!isKnownFileMimeType(declaredType) || !allowed.includes(declaredType)) {
      return { ok: false, reason: 'FILE_CONTENT_TYPE_NOT_ALLOWED' };
    }
    if (!matchesFileMagicBytes(incoming.content, declaredType)) {
      // El tipo declarado no coincide con los primeros bytes: renombrar un ejecutable a `.png` se
      // detiene exactamente aquí.
      return { ok: false, reason: 'FILE_CONTENT_TYPE_MISMATCH' };
    }

    const scan = await this.malwareScanner.scan(incoming.content);
    if (scan.status === 'infected') {
      this.logger.warn(`Archivo rechazado por malware (${scan.signature}).`);
      return { ok: false, reason: 'FILE_MALWARE_DETECTED' };
    }
    if (scan.status === 'error' && this.malwareScanner.failsClosed()) {
      // Con el escáner configurado, un fallo de conexión no puede degradar a "aceptar": un antivirus
      // que se cae en silencio es peor que no tenerlo, porque genera confianza infundada.
      return { ok: false, reason: 'FILE_SCAN_UNAVAILABLE' };
    }

    return {
      ok: true,
      value: {
        content: incoming.content,
        contentType: declaredType,
        sizeBytes: incoming.content.byteLength,
        sha256Hex: createHash('sha256').update(incoming.content).digest('hex'),
        extension: extensionForMimeType(declaredType),
      },
    };
  }

  /**
   * Emite un permiso de subida firmado y de vida corta.
   *
   * El tamaño y el tipo se declaran ANTES y viajan firmados, así que el ticket ya acota lo que puede
   * subirse; aun así, lo subido debe pasar por `verifyStored` antes de darse por bueno: un ticket
   * limita la intención, no garantiza el contenido.
   */
  createUploadTicket(input: { scope: FileScope; contentType: string; sizeBytes: number; now?: Date }): FileUploadTicket {
    const contentType = input.contentType.toLowerCase().trim();
    if (!isKnownFileMimeType(contentType) || !this.config.getAllowedMimeTypes().includes(contentType)) {
      throw new UnsupportedMediaTypeException('FILE_CONTENT_TYPE_NOT_ALLOWED');
    }
    if (input.sizeBytes <= 0 || input.sizeBytes > this.config.getMaxBytes()) {
      throw new PayloadTooLargeException('FILE_TOO_LARGE');
    }

    return this.registry.resolveStorage().createUploadTicket({
      scope: input.scope,
      contentType,
      extension: extensionForMimeType(contentType),
      sizeBytes: input.sizeBytes,
      now: input.now,
    });
  }

  /**
   * Contrasta lo que el cliente DIJO haber subido contra el objeto realmente almacenado.
   *
   * Es el cierre del camino por ticket firmado: sin esto, el backend estaría confiando en una
   * afirmación del propio cliente sobre un archivo que nunca leyó.
   */
  async verifyStored(input: {
    storageKey: string;
    declaredSha256: string;
    declaredMimeType: string;
    declaredSizeBytes: number | null;
  }): Promise<FileVerificationResult<StoredFileRef>> {
    const object = await this.registry.resolveStorage().read(input.storageKey);
    if (!object) return { ok: false, reason: 'FILE_NOT_FOUND' };

    if (object.sha256Hex.toLowerCase() !== input.declaredSha256.toLowerCase()) {
      return { ok: false, reason: 'FILE_HASH_MISMATCH' };
    }
    if (input.declaredSizeBytes !== null && input.declaredSizeBytes !== object.sizeBytes) {
      return { ok: false, reason: 'FILE_SIZE_MISMATCH' };
    }

    const verification = await this.verify({
      declaredFilename: input.storageKey,
      declaredMimeType: input.declaredMimeType,
      sizeBytes: object.sizeBytes,
      content: object.content,
    });
    if (!verification.ok) return verification;

    return {
      ok: true,
      value: {
        adapter: this.registry.resolveStorage().name,
        storageKey: input.storageKey,
        sizeBytes: object.sizeBytes,
        contentType: verification.value.contentType,
        sha256Hex: object.sha256Hex,
        storedAt: new Date().toISOString(),
      },
    };
  }

  retrieve(storageKey: string): Promise<StoredFileContent | null> {
    return this.registry.resolveStorage().read(storageKey);
  }

  remove(storageKey: string): Promise<boolean> {
    return this.registry.resolveStorage().remove(storageKey);
  }

  private toHttpException(reason: FileRejectionReason): Error {
    if (reason === 'FILE_TOO_LARGE') return new PayloadTooLargeException(reason);
    if (reason === 'FILE_CONTENT_TYPE_NOT_ALLOWED') return new UnsupportedMediaTypeException(reason);
    return new BadRequestException(reason);
  }
}
