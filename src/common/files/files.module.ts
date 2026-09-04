/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system cablea la ingesta multipart, el almacén activo y la verificación central de archivos.
 */
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { MalwareScannerService } from '../storage/malware-scanner.service.js';
import { FileAdapterConfigService } from './file-adapter-config.service.js';
import { FileAdapterRegistry } from './file-adapter.registry.js';
import { FileService } from './file.service.js';
import { FilesConfigModule } from './files-config.module.js';
import { MulterIngestAdapter, buildMulterLimits } from './ingest/multer-ingest.adapter.js';
import { LocalFileStorageAdapter } from './storage/local-file-storage.adapter.js';
import { MinioFileStorageAdapter } from './storage/minio-file-storage.adapter.js';

/**
 * Servicio de archivos con estructura de puertos y adaptadores.
 *
 * Se exporta `MulterModule` para que los módulos de dominio puedan usar `FileInterceptor` con los
 * límites ya configurados desde el entorno, sin volver a declararlos —ni poder relajarlos— en cada
 * controlador.
 *
 * No sustituye ni desactiva nada de `common/storage`: el flujo de evidencia KYC sobre S3 prefirmado
 * sigue intacto y con sus mismas garantías. Este módulo es la vía alterna, y desde 2026-09-03 apunta
 * al MISMO MinIO por defecto — un solo almacén que respaldar, dos prefijos dentro del bucket.
 */
@Module({
  imports: [
    FilesConfigModule,
    MulterModule.registerAsync({
      imports: [FilesConfigModule],
      inject: [FileAdapterConfigService],
      // Sin `storage` ni `dest`, multer entrega los bytes en memoria: el servicio los necesita para
      // hashear, comprobar la firma mágica y escanear ANTES de que toquen el disco.
      useFactory: (config: FileAdapterConfigService) => ({ limits: buildMulterLimits(config) }),
    }),
  ],
  // Los DOS almacenes se instancian siempre; el registro elige uno al arrancar. Instanciar sólo el
  // seleccionado obligaría a una fábrica que lee `env` fuera de `FileAdapterConfigService`, y son
  // objetos sin estado ni conexión abierta: el que no se usa no cuesta nada.
  providers: [
    MalwareScannerService,
    MulterIngestAdapter,
    MinioFileStorageAdapter,
    LocalFileStorageAdapter,
    FileAdapterRegistry,
    FileService,
  ],
  // `MinioFileStorageAdapter` se exporta además del servicio porque el módulo de expedientes
  // necesita EMITIR tickets de subida y escribir objetos desde el servidor, y eso es una capacidad
  // del almacén, no de la verificación. `FileService` sigue siendo la puerta para verificar.
  exports: [FileService, FileAdapterRegistry, MinioFileStorageAdapter, FilesConfigModule, MulterModule],
})
export class FilesModule {}
