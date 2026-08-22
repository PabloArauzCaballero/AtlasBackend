/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system declara los puertos de ingesta y almacenamiento de archivos, sin atarse a ningún proveedor.
 */

/**
 * Los DOS ejes del servicio de archivos. Separarlos es lo que hace la estructura poligonal:
 *
 *  - INGESTA    → cómo llegan los bytes al proceso (multipart por multer, o una URL prefirmada que
 *                 el cliente usa contra el almacén sin pasar por la API).
 *  - ALMACÉN    → dónde quedan finalmente (disco local hoy; Cloudinary o S3 mañana).
 *
 * Mezclarlos en una sola interfaz obligaría a reimplementar la ingesta cada vez que cambia el
 * destino, que es justo lo que esta división evita.
 */
export type FileIngestAdapterName = 'multer';
export type FileStorageAdapterName = 'local';

/**
 * Archivo tal como entra al proceso, ya normalizado por el adaptador de ingesta.
 *
 * `declaredFilename` y `declaredMimeType` los propone QUIEN SUBE: se conservan para diagnóstico y
 * para elegir extensión, pero nunca se usan para construir la ruta ni se creen sin contrastarlos
 * contra los bytes reales (ver `FileService.store`).
 */
export type IncomingFile = {
  declaredFilename: string;
  declaredMimeType: string;
  sizeBytes: number;
  content: Buffer;
};

/**
 * Espacio lógico donde vive el archivo. El servidor IMPONE la ruta a partir de estos campos: el
 * prefijo `tenantId/ownerId/` es lo que impide que un cliente escriba —o lea— fuera de su espacio,
 * exactamente el mismo criterio que ya aplica el almacenamiento de evidencia documental.
 */
export type FileScope = {
  tenantId: string;
  ownerId: string;
  category: string;
};

/** Archivo ya verificado por el servicio central: los bytes coinciden con lo que dicen ser. */
export type VerifiedFile = {
  content: Buffer;
  contentType: string;
  sizeBytes: number;
  sha256Hex: string;
  extension: string;
};

/** Referencia persistible. Es lo único que un dominio debe guardar en su tabla. */
export type StoredFileRef = {
  adapter: FileStorageAdapterName;
  storageKey: string;
  sizeBytes: number;
  contentType: string;
  sha256Hex: string;
  storedAt: string;
};

export type StoredFileContent = {
  content: Buffer;
  sizeBytes: number;
  contentType: string | null;
  sha256Hex: string;
};

/**
 * Permiso de subida acotado y firmado.
 *
 * Misma forma que el ticket prefirmado de S3 que ya existe en `common/storage`, a propósito: un
 * cliente que hoy habla con S3 y mañana con el almacén local no debería notar la diferencia.
 */
export type FileUploadTicket = {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  /** Cabeceras EXACTAS que el cliente debe enviar: van firmadas, alterarlas invalida la URL. */
  requiredHeaders: Record<string, string>;
  expiresAt: string;
};

export type UploadTicketInput = {
  scope: FileScope;
  contentType: string;
  extension: string;
  sizeBytes: number;
  now?: Date;
};

/**
 * Puerto de almacenamiento. Añadir Cloudinary es implementar esta interfaz y sumar su nombre a
 * `FileStorageAdapterName`; nada más del sistema cambia.
 */
export interface FileStorageAdapter {
  readonly name: FileStorageAdapterName;
  /** `false` si al adaptador le falta configuración; el registro lo rechaza al arrancar. */
  isConfigured(): boolean;
  write(scope: FileScope, file: VerifiedFile): Promise<StoredFileRef>;
  read(storageKey: string): Promise<StoredFileContent | null>;
  remove(storageKey: string): Promise<boolean>;
  createUploadTicket(input: UploadTicketInput): FileUploadTicket;
}

/**
 * Puerto de ingesta: traduce el objeto nativo del framework (el `file` de multer, hoy) al
 * `IncomingFile` que entiende el servicio. Mantener esta traducción en un adaptador es lo que deja
 * al `FileService` libre de Express y, por tanto, comprobable sin levantar un servidor HTTP.
 */
export interface FileIngestAdapter {
  readonly name: FileIngestAdapterName;
  /** Lanza `BadRequestException` si `raw` no tiene la forma que produce esta vía de ingesta. */
  normalize(raw: unknown): IncomingFile;
  normalizeMany(raw: unknown): IncomingFile[];
}

/** Motivos de rechazo. Códigos estables: viajan al cliente y se usan en pruebas y tableros. */
export type FileRejectionReason =
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'FILE_CONTENT_TYPE_NOT_ALLOWED'
  | 'FILE_CONTENT_TYPE_MISMATCH'
  | 'FILE_HASH_MISMATCH'
  | 'FILE_SIZE_MISMATCH'
  | 'FILE_MALWARE_DETECTED'
  | 'FILE_SCAN_UNAVAILABLE'
  | 'FILE_NOT_FOUND';

export type FileVerificationResult<T> = { ok: true; value: T } | { ok: false; reason: FileRejectionReason };
