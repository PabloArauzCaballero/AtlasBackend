/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system resuelve desde el entorno qué adaptadores de archivo operan y con qué límites.
 */
import { Injectable } from '@nestjs/common';
import { env } from '../../config/env.js';
import { isKnownFileMimeType, type KnownFileMimeType } from './file-content-type.util.js';
import type { S3Credentials } from '../storage/s3-signature.util.js';
import type { FileIngestAdapterName, FileStorageAdapterName } from './file-storage.types.js';
import type { LocalSignatureCredentials } from './local-signature.util.js';

/**
 * Único punto donde el subsistema de archivos toca `env`.
 *
 * Es el mismo criterio que `NotificationProviderConfigService`: mantener a los adaptadores libres de
 * `env` es lo que permite ejercitarlos en pruebas unitarias sin recargar el módulo de configuración
 * ni ensuciar `process.env`.
 */
@Injectable()
export class FileAdapterConfigService {
  getIngestAdapter(): FileIngestAdapterName {
    return env.FILE_INGEST_ADAPTER;
  }

  getStorageAdapter(): FileStorageAdapterName {
    return env.FILE_STORAGE_ADAPTER;
  }

  getMaxBytes(): number {
    return env.FILE_UPLOAD_MAX_BYTES;
  }

  getMaxFiles(): number {
    return env.FILE_UPLOAD_MAX_FILES;
  }

  getUploadUrlTtlSeconds(): number {
    return env.FILE_UPLOAD_URL_TTL_SECONDS;
  }

  /**
   * Allowlist efectiva. Se descartan los tipos sin firma mágica conocida en vez de aceptarlos: un
   * tipo que nadie sabe verificar, admitido en la lista, sería exactamente el hueco por el que
   * entraría contenido arbitrario. `FileStorageRegistry` falla al arrancar si la lista queda vacía o
   * si el operador declaró tipos imposibles de verificar, para que el descarte no pase inadvertido.
   */
  getAllowedMimeTypes(): KnownFileMimeType[] {
    return this.parseMimeTypes().known;
  }

  /** Tipos declarados en el entorno que ninguna firma mágica puede verificar. */
  getUnverifiableMimeTypes(): string[] {
    return this.parseMimeTypes().unknown;
  }

  private parseMimeTypes(): { known: KnownFileMimeType[]; unknown: string[] } {
    const declared = [
      ...new Set(
        env.FILE_UPLOAD_ALLOWED_MIME_TYPES.split(',')
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0),
      ),
    ];
    return {
      known: declared.filter((value): value is KnownFileMimeType => isKnownFileMimeType(value)),
      unknown: declared.filter((value) => !isKnownFileMimeType(value)),
    };
  }

  /**
   * Credenciales del almacén MinIO, con caída a las de la evidencia documental.
   *
   * La caída es la decisión importante y es deliberada: hay UN MinIO por entorno, y obligar a
   * declarar dos juegos de variables para el mismo servidor sólo habría creado la oportunidad de
   * que se desalinearan —un despliegue con la evidencia en un bucket y los archivos en otro que
   * nadie creó—. Las `FILE_STORAGE_MINIO_*` existen para el caso raro de querer separarlos a
   * propósito, y entonces mandan.
   *
   * Devuelve `null` —y no una excepción— si falta algo esencial: `FileAdapterRegistry` lo convierte
   * en un fallo de ARRANQUE con mensaje accionable, que es donde debe descubrirse.
   */
  getMinioCredentials(): S3Credentials | null {
    const endpoint = env.FILE_STORAGE_MINIO_ENDPOINT ?? env.STORAGE_S3_ENDPOINT;
    const bucket = env.FILE_STORAGE_MINIO_BUCKET ?? env.STORAGE_S3_BUCKET;
    const accessKeyId = env.FILE_STORAGE_MINIO_ACCESS_KEY_ID ?? env.STORAGE_S3_ACCESS_KEY_ID;
    const secretAccessKey = env.FILE_STORAGE_MINIO_SECRET_ACCESS_KEY ?? env.STORAGE_S3_SECRET_ACCESS_KEY;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

    return {
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: env.FILE_STORAGE_MINIO_REGION ?? env.STORAGE_S3_REGION,
      forcePathStyle: env.FILE_STORAGE_MINIO_FORCE_PATH_STYLE ?? env.STORAGE_S3_FORCE_PATH_STYLE,
    };
  }

  /**
   * El extremo por el que llega el NAVEGADOR o el teléfono, cuando no es el mismo por el que llega
   * este proceso. Vacío significa «es el mismo», que es el caso de un despliegue de una sola red.
   */
  getMinioPublicEndpoint(): string | null {
    return env.FILE_STORAGE_MINIO_PUBLIC_ENDPOINT ?? env.STORAGE_S3_PUBLIC_ENDPOINT ?? null;
  }

  /** Prefijo de las claves de este servicio dentro del bucket compartido. Vacío = sin prefijo. */
  getMinioKeyPrefix(): string {
    return env.FILE_STORAGE_MINIO_KEY_PREFIX.trim().replace(/^\/+|\/+$/g, '');
  }

  getLocalRoot(): string {
    return env.FILE_STORAGE_LOCAL_ROOT;
  }

  /**
   * Credenciales de firma del almacén local. `null` —y no una excepción— cuando falta el secreto:
   * el registro lo convierte en un fallo de arranque con mensaje accionable, y el adaptador puede
   * seguir escribiendo por la vía directa (multer) aunque no pueda emitir tickets.
   */
  getLocalSignatureCredentials(): LocalSignatureCredentials | null {
    const secret = env.FILE_STORAGE_LOCAL_URL_SECRET?.trim();
    if (!secret) return null;
    return { secret, uploadBaseUrl: env.FILE_STORAGE_LOCAL_BASE_URL };
  }
}
