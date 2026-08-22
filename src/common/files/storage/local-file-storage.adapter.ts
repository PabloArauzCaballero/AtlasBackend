/**
 * @file Adaptador de infraestructura: traduce el puerto del dominio a una tecnología concreta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system persiste archivos verificados en el disco local con ruta impuesta y permisos restringidos.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { FileAdapterConfigService } from '../file-adapter-config.service.js';
import { presignLocalUrl } from '../local-signature.util.js';
import type {
  FileScope,
  FileStorageAdapter,
  FileUploadTicket,
  StoredFileContent,
  StoredFileRef,
  UploadTicketInput,
  VerifiedFile,
} from '../file-storage.types.js';

/** Solo el propietario del proceso puede leer lo almacenado: es evidencia de clientes, no un asset público. */
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

/**
 * Almacén en disco local.
 *
 * Existe para poder ejercitar el camino completo —ticket firmado, verificación de bytes, escritura y
 * lectura— sin depender de un bucket. NO es una versión relajada del almacén de producción: impone
 * la misma ruta `tenant/owner/categoría/uuid`, firma los tickets con vencimiento y escribe con
 * permisos restringidos.
 *
 * Deliberadamente NO borra ni toca nada de `common/storage`: el flujo de evidencia KYC sobre S3
 * prefirmado sigue exactamente igual. Este adaptador es una opción más del puerto, como lo será
 * Cloudinary.
 */
@Injectable()
export class LocalFileStorageAdapter implements FileStorageAdapter {
  readonly name = 'local' as const;
  private readonly logger = new Logger(LocalFileStorageAdapter.name);

  constructor(private readonly config: FileAdapterConfigService) {}

  isConfigured(): boolean {
    return this.config.getLocalRoot().trim().length > 0;
  }

  /**
   * Resuelve la ruta absoluta y garantiza que cae DENTRO de la raíz configurada.
   *
   * Es la defensa contra `../`: la clave la construye el servidor, pero `read`/`remove` reciben
   * claves que en algún momento viajaron por la red, y confiar en su forma sería suficiente para
   * leer `/etc/passwd` desde un endpoint de descarga.
   */
  private absolutePathFor(storageKey: string): string {
    const root = resolve(this.config.getLocalRoot());
    const absolute = resolve(root, storageKey);
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new ServiceUnavailableException('FILE_STORAGE_KEY_OUTSIDE_ROOT');
    }
    return absolute;
  }

  /** Cada segmento se reduce al alfabeto seguro: ni separadores, ni `..`, ni unidades de Windows. */
  private safeSegment(value: string): string {
    const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
    return cleaned.length > 0 ? cleaned.slice(0, 64) : 'unknown';
  }

  private buildStorageKey(scope: FileScope, extension: string): string {
    return [
      this.safeSegment(scope.tenantId),
      this.safeSegment(scope.ownerId),
      this.safeSegment(scope.category),
      `${randomUUID()}.${extension}`,
    ].join('/');
  }

  async write(scope: FileScope, file: VerifiedFile): Promise<StoredFileRef> {
    const storageKey = this.buildStorageKey(scope, file.extension);
    const absolute = this.absolutePathFor(storageKey);

    await mkdir(dirname(absolute), { recursive: true, mode: DIRECTORY_MODE });

    // Escritura en dos pasos: un fallo a mitad de camino deja un `.part` huérfano en vez de un
    // archivo truncado que la verificación posterior daría por bueno por existir.
    const temporary = `${absolute}.${randomUUID()}.part`;
    try {
      await writeFile(temporary, file.content, { mode: FILE_MODE });
      await rename(temporary, absolute);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }

    // Se registra la CLAVE, nunca el nombre original ni el contenido: en un backend KYC el nombre de
    // archivo del cliente es PII.
    this.logger.log(`Archivo almacenado en disco local: ${storageKey} (${file.sizeBytes} bytes).`);

    return {
      adapter: this.name,
      storageKey,
      sizeBytes: file.sizeBytes,
      contentType: file.contentType,
      sha256Hex: file.sha256Hex,
      storedAt: new Date().toISOString(),
    };
  }

  async read(storageKey: string): Promise<StoredFileContent | null> {
    const absolute = this.absolutePathFor(storageKey);
    try {
      const content = await readFile(absolute);
      return {
        content,
        sizeBytes: content.byteLength,
        // El disco no guarda el `Content-Type`: quien lo necesite lo tiene en su propia tabla, junto
        // a la `storageKey`. Devolver `null` es más honesto que adivinarlo por la extensión.
        contentType: null,
        sha256Hex: createHash('sha256').update(content).digest('hex'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(storageKey: string): Promise<boolean> {
    const absolute = this.absolutePathFor(storageKey);
    try {
      await rm(absolute);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /**
   * Emite un permiso de subida firmado contra el endpoint local, con la misma forma que el ticket
   * prefirmado de S3: el cliente que hoy sube a un bucket y mañana a disco no cambia su código.
   */
  createUploadTicket(input: UploadTicketInput): FileUploadTicket {
    const credentials = this.config.getLocalSignatureCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException('FILE_STORAGE_LOCAL_URL_SECRET_MISSING');
    }

    const now = input.now ?? new Date();
    const storageKey = this.buildStorageKey(input.scope, input.extension);
    const requiredHeaders = { 'content-type': input.contentType, 'content-length': String(input.sizeBytes) };

    const { url, expiresAt } = presignLocalUrl({
      credentials,
      method: 'PUT',
      storageKey,
      expiresInSeconds: this.config.getUploadUrlTtlSeconds(),
      signedHeaders: requiredHeaders,
      now,
    });

    return { storageKey, uploadUrl: url, method: 'PUT', requiredHeaders, expiresAt: expiresAt.toISOString() };
  }

  /** Ruta absoluta de una clave. Expuesta para pruebas y diagnóstico, ya validada contra la raíz. */
  resolvePath(storageKey: string): string {
    return join(this.absolutePathFor(storageKey));
  }
}
