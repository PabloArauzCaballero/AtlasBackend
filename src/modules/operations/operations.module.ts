import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FraudCaseModel, ManualReviewCaseModel } from '../../database/models/index.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [SequelizeModule.forFeature([ManualReviewCaseModel, FraudCaseModel])],
  controllers: [OperationsController],
  providers: [OperationsRepository, OperationsService],
})
export class OperationsModule {}
