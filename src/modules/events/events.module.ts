/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza desacopla procesos de negocio y permite reintentos auditables sin perder eventos.
 * @system registra definiciones, outbox y procesamiento idempotente de eventos de dominio.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { OutboxEventModel } from '../../database/models/index.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { EventsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [SequelizeModule.forFeature([OutboxEventModel]), NotificationsModule],
  controllers: [EventsController],
  providers: [EventsRepository, EventsService],
  exports: [EventsService],
})
export class EventsModule {}
