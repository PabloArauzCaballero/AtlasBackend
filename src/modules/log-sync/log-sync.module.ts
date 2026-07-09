import { Module } from '@nestjs/common';
import { ArchivoLogMongoSyncService } from './log-sync.service.js';

@Module({
  providers: [ArchivoLogMongoSyncService],
})
export class LogSyncModule {}
