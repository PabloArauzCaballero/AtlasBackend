/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza preserva evidencia operativa suficiente para diagnosticar incidentes con retención limitada.
 * @system sincroniza logs redactados hacia MongoDB, aplica TTL y ofrece consultas administrativas.
 */
import { Module } from '@nestjs/common';
import { ArchivoLogMongoSyncService } from './log-sync.service.js';
import { MongoLogsController } from './mongo-logs.controller.js';
import { MongoLogsQueryService } from './mongo-logs-query.service.js';

@Module({
  controllers: [MongoLogsController],
  providers: [ArchivoLogMongoSyncService, MongoLogsQueryService],
})
export class LogSyncModule {}
