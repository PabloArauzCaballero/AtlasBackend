import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerObservationModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { RiskModule } from '../risk/risk.module.js';
import { FraudModule } from '../fraud/fraud.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      ManualReviewCaseModel,
      FraudCaseModel,
      ManualReviewEventModel,
      CustomerStatusEventModel,
      OperationalAuditLogModel,
      DataChangeLogModel,
      CustomerObservationModel,
    ]),
    CustomersModule,
    RiskModule,
    FraudModule,
  ],
  controllers: [OperationsController],
  providers: [OperationsRepository, OperationsService],
})
export class OperationsModule {}
