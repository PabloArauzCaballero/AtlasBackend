import { Module } from '@nestjs/common';
import { AdminReadController } from './admin-read.controller.js';
import { AdminReadService } from './application/admin-read.service.js';
import { InternalPortalController } from './internal-portal.controller.js';
import { InternalPortalService } from './internal-portal.service.js';

@Module({
  controllers: [InternalPortalController, AdminReadController],
  providers: [InternalPortalService, AdminReadService],
})
export class InternalPortalModule {}
