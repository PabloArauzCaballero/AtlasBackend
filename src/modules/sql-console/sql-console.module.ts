/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system agrupa el catálogo y el ejecutor de la consola SQL de solo lectura.
 */
import { Module } from '@nestjs/common';
import { DataNotebookModule } from '../data-notebook/data-notebook.module.js';
import { SqlConsoleCatalogService } from './sql-console-catalog.service.js';
import { SqlConsoleQueryService } from './sql-console-query.service.js';
import { SqlConsoleController } from './sql-console.controller.js';

/**
 * Importa el cuaderno por su HISTORIAL, no por sus datasets.
 *
 * Las dos pantallas guardan lo mismo —la consulta, nunca el resultado— en la misma tabla, y darle
 * a la consola una tabla propia habría partido en dos la respuesta a «qué se consultó aquí»: quien
 * audite tendría que acordarse de mirar en dos sitios, y el día que se olvide vería la mitad.
 */
@Module({
  imports: [DataNotebookModule],
  controllers: [SqlConsoleController],
  providers: [SqlConsoleCatalogService, SqlConsoleQueryService],
})
export class SqlConsoleModule {}
