/**
 * @file Raíz de composición de la API HTTP (AT-045).
 * @business El proceso que atiende peticiones compone presentación, casos de uso y su infraestructura;
 *   no arranca trabajos de fondo (eso lo decide `APP_ROLE`, que el planificador ya respeta).
 * @system Hoy reexporta la composición completa de `AppModule` para conservar compatibilidad (tests,
 *   generación de OpenAPI, smokes). La raíz existe para que la API y el worker dejen de compartir un
 *   único punto de composición: lo que se retire de aquí en F9 no afecta al worker, y viceversa.
 */
import { Module } from '@nestjs/common';
import { AppModule } from '../app.module.js';

@Module({ imports: [AppModule] })
export class ApiModule {}
