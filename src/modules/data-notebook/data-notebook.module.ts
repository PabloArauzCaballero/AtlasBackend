/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system agrupa el catálogo y la lectura de datasets del cuaderno de datos.
 */
import { Module } from '@nestjs/common';
import { DataNotebookCatalogService } from './data-notebook-catalog.service.js';
import { DataNotebookDatasetService } from './data-notebook-dataset.service.js';
import { DataNotebookController } from './data-notebook.controller.js';

/**
 * No importa `ReadDatabaseModule`: es `@Global`, así que `ReadQueryService` ya está disponible.
 * Tampoco importa `AuditModule`: el interceptor global `HttpActionLogInterceptor` registra cada
 * petición HTTP con su actor, su ruta y su desenlace, de modo que auditar aquí a mano duplicaría
 * la evidencia y las dos copias podrían divergir.
 */
@Module({
  controllers: [DataNotebookController],
  providers: [DataNotebookCatalogService, DataNotebookDatasetService],
  exports: [DataNotebookCatalogService],
})
export class DataNotebookModule {}
