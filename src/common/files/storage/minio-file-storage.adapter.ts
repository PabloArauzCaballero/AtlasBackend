/**
 * @file Adaptador de infraestructura: traduce el puerto del dominio a una tecnología concreta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system persiste archivos verificados en un almacén compatible con S3 (MinIO) con ruta impuesta por el servidor.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { presignS3Url, type S3Credentials } from '../../storage/s3-signature.util.js';
import { FileAdapterConfigService } from '../file-adapter-config.service.js';
import type {
  FileScope,
  FileStorageAdapter,
  FileUploadTicket,
  StoredFileContent,
  StoredFileRef,
  UploadTicketInput,
  VerifiedFile,
} from '../file-storage.types.js';

/**
 * Almacén de objetos compatible con S3 — MinIO en los despliegues de Atlas.
 *
 * Es el almacén POR DEFECTO, y esa es la diferencia práctica con `local`: un archivo escrito en el
 * disco del contenedor desaparece con el contenedor, y en Coolify cada despliegue crea uno nuevo.
 * Eso convertía «guardado» en «guardado hasta el próximo despliegue», que para la cara de una
 * persona y su cédula no es guardar. Aquí los bytes viven en un volumen propio del almacén, fuera
 * del ciclo de vida de la aplicación.
 *
 * Habla el mismo protocolo y usa la MISMA firma SigV4 que `DocumentStorageService`
 * (`common/storage`), a propósito: hay un solo MinIO, un solo juego de credenciales y un solo
 * bucket por entorno, así que la evidencia KYC y los archivos de este servicio acaban en el mismo
 * sitio y se operan igual. Lo que cambia es el prefijo de la clave, no el destino.
 *
 * No se añade el SDK de AWS por lo mismo que explica `s3-signature.util.ts`: de todo el árbol de
 * dependencias sólo se necesitan tres verbos firmados (PUT, GET, DELETE).
 */
@Injectable()
export class MinioFileStorageAdapter implements FileStorageAdapter {
  readonly name = 'minio' as const;
  private readonly logger = new Logger(MinioFileStorageAdapter.name);

  constructor(private readonly config: FileAdapterConfigService) {}

  isConfigured(): boolean {
    return this.config.getMinioCredentials() !== null;
  }

  /**
   * Credenciales para hablar CON el almacén desde este proceso.
   *
   * Lanza 503 —y no un error de arranque— porque el registro ya falla al arrancar si el adaptador
   * activo no está configurado; si se llega aquí sin credenciales es porque alguien resolvió este
   * adaptador sin que fuera el seleccionado, y degradar a un 503 es preferible a tumbar el proceso.
   */
  private credentials(): S3Credentials {
    const credentials = this.config.getMinioCredentials();
    if (!credentials) throw new ServiceUnavailableException('FILE_STORAGE_MINIO_NOT_CONFIGURED');
    return credentials;
  }

  /**
   * Las mismas credenciales con el extremo PÚBLICO.
   *
   * Son dos caminos a la misma cosa: este proceso alcanza MinIO por el nombre de servicio de su red
   * (`http://minio:9000`), y el teléfono del cliente por el dominio publicado. La firma se calcula
   * sobre el mismo bucket, la misma clave y el mismo secreto, así que el objeto es el mismo por los
   * dos caminos. Sin este desdoblamiento, la URL que se le entrega al teléfono es correcta y no la
   * puede abrir nadie — y el error que ve el usuario es «no podemos recibir documentos», que no
   * menciona la red por ninguna parte.
   */
  private publicCredentials(): S3Credentials {
    const base = this.credentials();
    const publicEndpoint = this.config.getMinioPublicEndpoint();
    return publicEndpoint ? { ...base, endpoint: publicEndpoint } : base;
  }

  /**
   * Cada segmento se reduce al alfabeto seguro.
   *
   * En un almacén de objetos no hay travesía de directorios que temer —la clave es una cadena, no
   * una ruta— pero sí hay claves que S3 codifica de formas distintas según el cliente, y una clave
   * que se escribe con un nombre y se lee con otro es un archivo perdido. Se conserva la misma
   * normalización que el adaptador local para que la ruta de un archivo no dependa de dónde acabó.
   */
  private safeSegment(value: string): string {
    const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
    return cleaned.length > 0 ? cleaned.slice(0, 64) : 'unknown';
  }

  /**
   * La clave la construye SIEMPRE el servidor: `prefijo/tenant/dueño/categoría/uuid.ext`.
   *
   * El prefijo de tenant y dueño es lo que impide que un cliente escriba —o lea— fuera de su
   * espacio, y permite que la política del bucket se restrinja a ese patrón. El `uuid` evita que
   * dos subidas del mismo documento se pisen.
   */
  private buildStorageKey(scope: FileScope, extension: string): string {
    const prefix = this.config.getMinioKeyPrefix();
    return [
      ...(prefix ? [prefix] : []),
      this.safeSegment(scope.tenantId),
      this.safeSegment(scope.ownerId),
      this.safeSegment(scope.category),
      `${randomUUID()}.${extension}`,
    ].join('/');
  }

  async write(scope: FileScope, file: VerifiedFile): Promise<StoredFileRef> {
    const credentials = this.credentials();
    const storageKey = this.buildStorageKey(scope, file.extension);

    // La subida la hace ESTE proceso contra una URL que él mismo firma. Se firma en vez de mandar
    // la cabecera `Authorization` porque es el mismo camino que ya ejercitan las lecturas y los
    // tickets: un solo mecanismo que falla —o funciona— igual en los tres verbos.
    const requiredHeaders = { 'content-type': file.contentType, 'content-length': String(file.sizeBytes) };
    const url = presignS3Url({
      credentials,
      method: 'PUT',
      objectKey: storageKey,
      expiresInSeconds: 60,
      signedHeaders: requiredHeaders,
      now: new Date(),
    });

    const response = await fetch(url, { method: 'PUT', headers: requiredHeaders, body: new Uint8Array(file.content) });
    if (!response.ok) {
      // El cuerpo del error de S3 es XML y no trae PII, pero sí el nombre del bucket y la clave;
      // se recorta porque un 403 de firma repetido llenaría el log con el mismo párrafo.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      this.logger.error(`MinIO rechazó la escritura de ${storageKey}: HTTP ${response.status}. ${detail}`);
      throw new ServiceUnavailableException('FILE_STORAGE_WRITE_FAILED');
    }

    // Se registra la CLAVE, nunca el nombre original ni el contenido: en un backend KYC el nombre de
    // archivo del cliente es PII.
    this.logger.log(`Archivo almacenado en MinIO: ${storageKey} (${file.sizeBytes} bytes).`);

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
    const credentials = this.credentials();
    const url = presignS3Url({ credentials, method: 'GET', objectKey: storageKey, expiresInSeconds: 60, now: new Date() });

    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      this.logger.warn(`MinIO no pudo servir ${storageKey}: HTTP ${response.status}.`);
      throw new ServiceUnavailableException('FILE_STORAGE_READ_FAILED');
    }

    const content = Buffer.from(await response.arrayBuffer());
    return {
      content,
      sizeBytes: content.byteLength,
      // A diferencia del disco, el almacén SÍ guarda el `Content-Type` que se firmó al subir; se
      // devuelve tal cual y sin adivinarlo por la extensión cuando falta.
      contentType: response.headers.get('content-type'),
      sha256Hex: createHash('sha256').update(content).digest('hex'),
    };
  }

  async remove(storageKey: string): Promise<boolean> {
    const credentials = this.credentials();
    const url = presignS3Url({ credentials, method: 'DELETE', objectKey: storageKey, expiresInSeconds: 60, now: new Date() });

    const response = await fetch(url, { method: 'DELETE' });
    // S3 responde 204 tanto si el objeto existía como si no: el borrado es idempotente por diseño.
    // Para distinguir «lo borré» de «no estaba» habría que preguntar antes, y eso convierte una
    // operación en dos con una carrera en medio. Se devuelve `true` en el rango de éxito y quien
    // necesite la diferencia la obtiene de `read`.
    if (response.ok || response.status === 404) return response.status !== 404;

    this.logger.warn(`MinIO no pudo borrar ${storageKey}: HTTP ${response.status}.`);
    throw new ServiceUnavailableException('FILE_STORAGE_DELETE_FAILED');
  }

  /**
   * Emite un permiso de subida acotado, firmado contra el extremo PÚBLICO.
   *
   * Misma forma que el ticket del adaptador local y que el de `DocumentStorageService`: el cliente
   * que hoy sube a disco y mañana a MinIO no cambia una línea. Las cabeceras firmadas obligan tipo
   * y tamaño ANTES de que el objeto exista, así que un cliente no puede subir 400 MB por una URL
   * que se le concedió para 2 MB.
   */
  createUploadTicket(input: UploadTicketInput): FileUploadTicket {
    const credentials = this.publicCredentials();
    const now = input.now ?? new Date();
    const storageKey = this.buildStorageKey(input.scope, input.extension);
    const requiredHeaders = { 'content-type': input.contentType, 'content-length': String(input.sizeBytes) };
    const expiresInSeconds = this.config.getUploadUrlTtlSeconds();

    const uploadUrl = presignS3Url({
      credentials,
      method: 'PUT',
      objectKey: storageKey,
      expiresInSeconds,
      signedHeaders: requiredHeaders,
      now,
    });

    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      requiredHeaders,
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /**
   * URL firmada de LECTURA, para entregar al navegador o al teléfono.
   *
   * No forma parte del puerto porque el adaptador local no puede ofrecerla con las mismas
   * garantías, pero sí es la única forma sensata de mostrar un carnet sin que sus bytes crucen la
   * API dos veces. Vence pronto y se emite en el momento: el archivo nunca sale del almacén por una
   * URL que alguien pudiera guardar.
   */
  createDownloadUrl(storageKey: string, now: Date = new Date()): { url: string; expiresAt: string } {
    const credentials = this.publicCredentials();
    const expiresInSeconds = this.config.getUploadUrlTtlSeconds();
    const url = presignS3Url({ credentials, method: 'GET', objectKey: storageKey, expiresInSeconds, now });
    return { url, expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString() };
  }
}
