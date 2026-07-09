import { Module } from '@nestjs/common';
import { InternalPortalController } from './internal-portal.controller.js';
import { InternalPortalService } from './internal-portal.service.js';

@Module({
  controllers: [InternalPortalController],
  providers: [InternalPortalService],
})
export class InternalPortalModule {}
