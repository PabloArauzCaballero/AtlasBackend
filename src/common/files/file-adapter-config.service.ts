/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system resuelve desde el entorno qué adaptadores de archivo operan y con qué límites.
 */
import { Injectable } from '@nestjs/common';
import { env } from '../../config/env.js';
import { isKnownFileMimeType, type KnownFileMimeType } from './file-content-type.util.js';
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
