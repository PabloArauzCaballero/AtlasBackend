/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system resuelve el adaptador activo de cada eje y falla al arrancar si la configuración es inservible.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FileAdapterConfigService } from './file-adapter-config.service.js';
import { MulterIngestAdapter } from './ingest/multer-ingest.adapter.js';
import { LocalFileStorageAdapter } from './storage/local-file-storage.adapter.js';
import type { FileIngestAdapter, FileStorageAdapter } from './file-storage.types.js';

/**
 * Registro de los dos ejes.
 *
 * Valida al ARRANCAR, no en la primera subida: una allowlist vacía o un almacén mal configurado
 * descubierto a mitad de un onboarding es un incidente; descubierto al desplegar es un despliegue
 * que no sale. Mismo criterio que `ExternalProviderRegistryService` en `external-data`.
 *
 * Sumar Cloudinary será: implementar `FileStorageAdapter`, añadirlo al arreglo del constructor y
 * sumar su nombre al enum de `FILE_STORAGE_ADAPTER`. Ningún consumidor cambia.
 */
@Injectable()
export class FileAdapterRegistry implements OnModuleInit {
  private readonly logger = new Logger(FileAdapterRegistry.name);
  private readonly storageAdapters: FileStorageAdapter[];
  private readonly ingestAdapters: FileIngestAdapter[];

  constructor(
    private readonly config: FileAdapterConfigService,
    local: LocalFileStorageAdapter,
    multer: MulterIngestAdapter,
  ) {
    this.storageAdapters = [local];
    this.ingestAdapters = [multer];
  }

  onModuleInit(): void {
    const storage = this.resolveStorage();
    if (!storage.isConfigured()) {
      throw new Error(
        `El adaptador de almacenamiento de archivos "${storage.name}" está seleccionado pero le falta configuración. ` +
          'Revisa las variables FILE_STORAGE_* en tu entorno.',
      );
    }

    const unverifiable = this.config.getUnverifiableMimeTypes();
    if (unverifiable.length > 0) {
      throw new Error(
        `FILE_UPLOAD_ALLOWED_MIME_TYPES declara tipos que el backend no sabe verificar por firma mágica: ${unverifiable.join(', ')}. ` +
          'Añade su firma en file-content-type.util.ts o quítalos de la lista; aceptarlos sin verificar dejaría entrar contenido arbitrario.',
      );
    }

    const allowed = this.config.getAllowedMimeTypes();
    if (allowed.length === 0) {
      throw new Error('FILE_UPLOAD_ALLOWED_MIME_TYPES no admite ningún tipo verificable: ninguna subida podría aceptarse.');
    }

    this.logger.log(
      `Servicio de archivos activo — ingesta: ${this.resolveIngest().name}, almacén: ${storage.name}, ` +
        `tipos: ${allowed.join(', ')}, máximo: ${this.config.getMaxBytes()} bytes.`,
    );
  }

  resolveStorage(): FileStorageAdapter {
    const selected = this.config.getStorageAdapter();
    const adapter = this.storageAdapters.find((candidate) => candidate.name === selected);
    if (!adapter) {
      throw new Error(`FILE_STORAGE_ADAPTER="${selected}" no corresponde a ningún adaptador registrado.`);
    }
    return adapter;
  }

  resolveIngest(): FileIngestAdapter {
    const selected = this.config.getIngestAdapter();
    const adapter = this.ingestAdapters.find((candidate) => candidate.name === selected);
    if (!adapter) {
      throw new Error(`FILE_INGEST_ADAPTER="${selected}" no corresponde a ningún adaptador registrado.`);
    }
    return adapter;
  }
}
