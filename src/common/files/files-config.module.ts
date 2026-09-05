/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system expone la configuración de archivos para que la fábrica de multer pueda inyectarla.
 */
import { Module } from '@nestjs/common';
import { FileAdapterConfigService } from './file-adapter-config.service.js';

/**
 * Módulo mínimo con un solo propósito: `MulterModule.registerAsync` resuelve sus dependencias en su
 * PROPIO contexto, no en el del módulo que lo importa, así que la fábrica de límites no vería a
 * `FileAdapterConfigService` si viviera únicamente dentro de `FilesModule`.
 *
 * La alternativa era instanciar el servicio a mano en la fábrica; se prefirió este módulo de tres
 * líneas para que siga habiendo una sola instancia y un solo punto que lee `env`.
 */
@Module({
  providers: [FileAdapterConfigService],
  exports: [FileAdapterConfigService],
})
export class FilesConfigModule {}
