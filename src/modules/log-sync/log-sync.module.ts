import { Module } from '@nestjs/common';
import { ArchivoLogMongoSyncService } from './log-sync.service.js';
import { MongoLogsController } from './mongo-logs.controller.js';
import { MongoLogsQueryService } from './mongo-logs-query.service.js';

@Module({
  controllers: [MongoLogsController],
  providers: [ArchivoLogMongoSyncService, MongoLogsQueryService],
})
export class LogSyncModule {}
