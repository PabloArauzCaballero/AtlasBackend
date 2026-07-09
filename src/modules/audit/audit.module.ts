import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AuthEventModel,
  ConsentEventModel,
  CustomerActionLogModel,
  CustomerConsentModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseEventModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
  SystemActionLogModel,
  SystemEndpointCatalogModel,
} from '../../database/models/index.js';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';
import { HttpActionLogService } from './http-action-log.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      OperationalAuditLogModel,
      SystemActionLogModel,
      SystemEndpointCatalogModel,
      DataChangeLogModel,
      CustomerStatusEventModel,
      CustomerActionLogModel,
      AuthEventModel,
      ConsentEventModel,
      ManualReviewEventModel,
      FraudCaseEventModel,
      CustomerConsentModel,
      ManualReviewCaseModel,
      FraudCaseModel,
    ]),
  ],
  controllers: [AuditController],
  providers: [AuditService, AuditRepository, HttpActionLogService],
  exports: [HttpActionLogService],
})
export class AuditModule {}
