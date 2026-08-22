/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de storage sin introducir reglas de un dominio específico.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { matchesFileMagicBytes } from '../files/file-content-type.util.js';
import { MalwareScannerService } from './malware-scanner.service.js';
import { S3Credentials, presignS3Url } from './s3-signature.util.js';

export type UploadTicket = {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  /** Cabeceras EXACTAS que el cliente debe enviar: van firmadas, alterarlas invalida la URL. */
  requiredHeaders: Record<string, string>;
  expiresAt: string;
};

export type StoredObjectMetadata = {
  sizeBytes: number;
  contentType: string | null;
  sha256Hex: string;
};

/** Tipos aceptados para evidencia documental, alineados con `identityEvidenceSchema`. */
export const ALLOWED_EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type AllowedEvidenceMimeType = (typeof ALLOWED_EVIDENCE_MIME_TYPES)[number];

export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

/**
 * Custodia de la evidencia documental del cliente.
 *
 * Antes, el cliente enviaba un `storageKey` de su elección y un `sha256Hash` que nadie comprobaba;
 * `s3_bucket` se guardaba `null` y el backend **nunca veía el archivo**. Eso significaba que el KYC
 * se apoyaba en una afirmación del propio cliente sobre un objeto que el sistema no podía leer.
 *
 * Ahora:
 *  - el servidor **impone la ruta** (`tenant/cliente/uuid`): el cliente no elige dónde escribe;
 *  - la URL prefirmada es de un solo uso, corta vida, y firma `Content-Type` y `Content-Length`;
 *  - antes de aceptar el paquete, el backend **descarga el objeto**, recalcula el SHA-256, verifica
 *    el tamaño y comprueba los bytes mágicos contra el tipo declarado.
 */
@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);

  constructor(private readonly malwareScanner: MalwareScannerService) {}

  isConfigured(): boolean {
    return Boolean(env.STORAGE_S3_ENDPOINT && env.STORAGE_S3_BUCKET && env.STORAGE_S3_ACCESS_KEY_ID && env.STORAGE_S3_SECRET_ACCESS_KEY);
  }

  getBucket(): string | null {
    return env.STORAGE_S3_BUCKET ?? null;
  }

  private credentials(): S3Credentials {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');
    }
    return {
      accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY as string,
      region: env.STORAGE_S3_REGION,
      endpoint: env.STORAGE_S3_ENDPOINT as string,
      bucket: env.STORAGE_S3_BUCKET as string,
      forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
    };
  }

  /**
   * Emite un permiso de subida acotado.
   *
   * El prefijo `tenantId/customerId/` es lo que impide que un cliente escriba —o lea— fuera de su
   * propio espacio: la política del bucket puede restringirse a ese patrón, y la clave nunca la
   * propone quien sube.
   */
  createUploadTicket(input: {
    tenantId: string;
    /**
     * A quién pertenece la evidencia. Se llamaba `customerId` y se generalizó al aparecer el
     * expediente del partner: la ruta del objeto es lo único que este servicio hace con él, así
     * que atarlo al vocabulario del cliente obligaba a duplicar el servicio entero para guardar
     * un QR. Quien llama antepone su prefijo (`partner-…`) para que dos sujetos con el mismo
     * número no compartan carpeta.
     */
    subjectId: string;
    documentType: string;
    contentType: AllowedEvidenceMimeType;
    sizeBytes: number;
    now?: Date;
  }): UploadTicket {
    const credentials = this.credentials();
    const now = input.now ?? new Date();
    const extension = input.contentType === 'application/pdf' ? 'pdf' : input.contentType === 'image/png' ? 'png' : 'jpg';
    const storageKey = `${input.tenantId}/${input.subjectId}/${input.documentType}/${randomUUID()}.${extension}`;

    const requiredHeaders = { 'content-type': input.contentType, 'content-length': String(input.sizeBytes) };
    const uploadUrl = presignS3Url({
      credentials,
      method: 'PUT',
      objectKey: storageKey,
      expiresInSeconds: env.STORAGE_UPLOAD_URL_TTL_SECONDS,
      signedHeaders: requiredHeaders,
      now,
    });

    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      requiredHeaders,
      expiresAt: new Date(now.getTime() + env.STORAGE_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Descarga el objeto y devuelve sus metadatos reales.
   *
   * Se descarga en vez de usar `HEAD` porque el hash hay que recalcularlo sobre el contenido: el
   * `ETag` de S3 no es un SHA-256 y deja de ser siquiera un MD5 en subidas multiparte.
   */
  async readObjectMetadata(storageKey: string): Promise<StoredObjectMetadata | null> {
    const credentials = this.credentials();
    const url = presignS3Url({
      credentials,
      method: 'GET',
      objectKey: storageKey,
      expiresInSeconds: 60,
      now: new Date(),
    });

    const response = await fetch(url);
    if (!response.ok) {
      this.logger.warn(`El objeto ${storageKey} no se pudo leer del almacenamiento (HTTP ${response.status}).`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      sizeBytes: buffer.byteLength,
      contentType: response.headers.get('content-type'),
      sha256Hex: createHash('sha256').update(buffer).digest('hex'),
      // El buffer se descarta aquí: nunca se persiste el contenido en la base ni en logs.
    };
  }

  /** Contrasta lo declarado por el cliente contra el objeto realmente almacenado. */
  /**
   * Descarga el objeto para procesarlo dentro del backend.
   *
   * Existe aparte de `verifyDeclaredObject` porque responde a otra pregunta. Aquella comprueba que
   * lo subido es lo declarado y devuelve un veredicto; ésta necesita el CONTENIDO, y la usa el
   * trabajo que lee el extracto bancario para calcular la capacidad de pago.
   *
   * La URL firmada dura 60 segundos y se emite en el momento: el archivo nunca sale del almacén
   * cifrado por una URL que alguien pudiera guardar, que es justo lo que se le promete al cliente
   * en la pantalla de subida.
   */
  async readObject(storageKey: string): Promise<Buffer | null> {
    if (!this.isConfigured()) return null;
    const credentials = this.credentials();
    const url = presignS3Url({ credentials, method: 'GET', objectKey: storageKey, expiresInSeconds: 60, now: new Date() });

    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_EVIDENCE_BYTES) return null;
    return buffer;
  }

  async verifyDeclaredObject(input: {
    storageKey: string;
    declaredSha256: string;
    declaredMimeType: AllowedEvidenceMimeType;
    declaredSizeBytes: number | null;
  }): Promise<{ ok: true; metadata: StoredObjectMetadata } | { ok: false; reason: string }> {
    const credentials = this.credentials();
    const url = presignS3Url({ credentials, method: 'GET', objectKey: input.storageKey, expiresInSeconds: 60, now: new Date() });

    const response = await fetch(url);
    if (!response.ok) return { ok: false, reason: 'EVIDENCE_OBJECT_NOT_FOUND' };

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) return { ok: false, reason: 'EVIDENCE_OBJECT_EMPTY' };
    if (buffer.byteLength > MAX_EVIDENCE_BYTES) return { ok: false, reason: 'EVIDENCE_OBJECT_TOO_LARGE' };

    const actualSha256 = createHash('sha256').update(buffer).digest('hex');
    if (actualSha256.toLowerCase() !== input.declaredSha256.toLowerCase()) {
      return { ok: false, reason: 'EVIDENCE_HASH_MISMATCH' };
    }
    if (input.declaredSizeBytes !== null && input.declaredSizeBytes !== buffer.byteLength) {
      return { ok: false, reason: 'EVIDENCE_SIZE_MISMATCH' };
    }
    if (!matchesMagicBytes(buffer, input.declaredMimeType)) {
      return { ok: false, reason: 'EVIDENCE_CONTENT_TYPE_MISMATCH' };
    }

    // Antimalware al final: es la comprobación más cara y no tiene sentido pagarla por un objeto que
    // ya falló el hash o el tipo. Se aprovecha el mismo buffer ya descargado.
    const scan = await this.malwareScanner.scan(buffer);
    if (scan.status === 'infected') {
      this.logger.warn(`Evidencia rechazada por malware (${scan.signature}): ${input.storageKey}`);
      return { ok: false, reason: 'EVIDENCE_MALWARE_DETECTED' };
    }
    if (scan.status === 'error' && this.malwareScanner.failsClosed()) {
      // Con el escáner configurado, un fallo de conexión no puede degradar a "aceptar": un antivirus
      // que se cae en silencio es peor que no tenerlo, porque genera confianza infundada.
      return { ok: false, reason: 'EVIDENCE_SCAN_UNAVAILABLE' };
    }

    return {
      ok: true,
      metadata: { sizeBytes: buffer.byteLength, contentType: response.headers.get('content-type'), sha256Hex: actualSha256 },
    };
  }
}

/**
 * Se conserva esta función —firma y semántica intactas— pero la TABLA de firmas pasó a
 * `common/files/file-content-type.util.ts`, compartida con el servicio de archivos por adaptadores.
 * Tener dos tablas habría permitido que un tipo quedara verificado en un camino y sin verificar en
 * el otro, que es exactamente la clase de hueco que esta comprobación existe para cerrar.
 */
export function matchesMagicBytes(buffer: Buffer, mimeType: AllowedEvidenceMimeType): boolean {
  return matchesFileMagicBytes(buffer, mimeType);
}
