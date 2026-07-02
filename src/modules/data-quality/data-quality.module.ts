import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DataChangeLogModel, DataQualityIssueModel, OperationalAuditLogModel } from '../../database/models/index.js';
import { DataQualityController } from './data-quality.controller.js';
import { DataQualityRepository } from './data-quality.repository.js';
import { DataQualityService } from './data-quality.service.js';

@Module({
  imports: [SequelizeModule.forFeature([DataQualityIssueModel, OperationalAuditLogModel, DataChangeLogModel])],
  controllers: [DataQualityController],
  providers: [DataQualityService, DataQualityRepository],
})
export class DataQualityModule {}
