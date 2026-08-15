/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system agrupa el catálogo, la lectura de datasets y el historial del cuaderno de datos.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DataNotebookQueryHistoryModel } from '../../database/models/index.js';
import { DataNotebookCatalogService } from './data-notebook-catalog.service.js';
import { DataNotebookDatasetService } from './data-notebook-dataset.service.js';
import { DataNotebookHistoryService } from './data-notebook-history.service.js';
import { DataNotebookController } from './data-notebook.controller.js';

/**
 * No importa `ReadDatabaseModule`: es `@Global`, así que `ReadQueryService` ya está disponible.
 * Tampoco importa `AuditModule`: el interceptor global `HttpActionLogInterceptor` registra cada
 * petición HTTP con su actor, su ruta y su desenlace, de modo que auditar a mano las lecturas
 * duplicaría la evidencia y las dos copias podrían divergir.
 *
 * El historial SÍ es propio y no lo cubre aquel interceptor: lo que registra es el CÓDIGO de la
 * celda, que nunca viaja como parte de una petición de lectura porque se ejecuta en el navegador.
 * Sin esta tabla, de una sesión de análisis quedaría constancia de qué datasets se cargaron y de
 * ninguna de las preguntas que se les hicieron.
 */
@Module({
  imports: [SequelizeModule.forFeature([DataNotebookQueryHistoryModel])],
  controllers: [DataNotebookController],
  providers: [DataNotebookCatalogService, DataNotebookDatasetService, DataNotebookHistoryService],
  exports: [DataNotebookCatalogService, DataNotebookHistoryService],
})
export class DataNotebookModule {}
