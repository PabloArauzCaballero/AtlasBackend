import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { buildSequelizeOptions } from '../config/database.config.js';
import {
  ConsentDocumentModel,
  ConsentEventModel,
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerDeviceLinkModel,
  CustomerModel,
  CustomerProfileVersionModel,
  CustomerSessionModel,
  CustomerStatusEventModel,
  DeviceModel,
  DeviceSnapshotModel,
  FraudCaseModel,
  GlobalDeviceFingerprintModel,
  ManualReviewCaseModel,
  RiskAssessmentResultModel,
  TenantModel,
} from './models/index.js';

export const databaseModels = [
  TenantModel,
  CustomerModel,
  CustomerProfileVersionModel,
  CustomerStatusEventModel,
  CustomerContactMethodModel,
  ConsentDocumentModel,
  CustomerConsentModel,
  ConsentEventModel,
  GlobalDeviceFingerprintModel,
  DeviceModel,
  CustomerDeviceLinkModel,
  CustomerSessionModel,
  DeviceSnapshotModel,
  RiskAssessmentResultModel,
  ManualReviewCaseModel,
  FraudCaseModel,
];

@Module({
  imports: [
    SequelizeModule.forRoot({
      ...buildSequelizeOptions(),
      models: databaseModels,
    }),
  ],
})
export class DatabaseModule {}
