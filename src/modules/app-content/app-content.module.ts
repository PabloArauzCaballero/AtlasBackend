/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza saca del código lo que el cliente lee en la app y lo pone donde se edita.
 * @system agrupa el catálogo de contenidos de la app y sus dos caminos de acceso.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AppContentEntryModel } from '../../database/models/index.js';
import { AppContentOperationsController } from './app-content-operations.controller.js';
import { AppContentController } from './app-content.controller.js';
import { AppContentService } from './app-content.service.js';

/**
 * Dos controllers para el mismo catálogo, y no es duplicación.
 *
 * El público devuelve sólo lo activo, en el idioma pedido y con las acciones ya resueltas —lo que la
 * app necesita para pintar y nada más—. El de operaciones devuelve TODO, incluido lo retirado, con
 * su estado de publicación y quién lo tocó. Son dos preguntas distintas con dos respuestas
 * distintas; servirlas desde el mismo endpoint obligaría a filtrar en el cliente lo que no debería
 * haber salido del servidor.
 */
@Module({
  imports: [SequelizeModule.forFeature([AppContentEntryModel])],
  controllers: [AppContentController, AppContentOperationsController],
  providers: [AppContentService],
  exports: [AppContentService],
})
export class AppContentModule {}
