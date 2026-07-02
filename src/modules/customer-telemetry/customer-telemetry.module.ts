import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AuthEventModel,
  CustomerActionLogModel,
  CustomerActivitySummaryModel,
  CustomerDeviceLinkModel,
  CustomerObservationModel,
  DeviceModel,
  DeviceRiskEventModel,
  DeviceSnapshotModel,
  FormFieldInteractionEventModel,
  IpReputationObservationModel,
  OnDeviceComputationRunModel,
  OnDeviceMetricValueModel,
  OnboardingBehaviorSummaryModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
  PermissionEventModel,
  SimObservationModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { CustomerTelemetryController } from './customer-telemetry.controller.js';
import { CustomerTelemetryRepository } from './customer-telemetry.repository.js';
import { CustomerTelemetryService } from './customer-telemetry.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      CustomerDeviceLinkModel,
      DeviceModel,
      DeviceSnapshotModel,
      DeviceRiskEventModel,
      SimObservationModel,
      AuthEventModel,
      IpReputationObservationModel,
      CustomerActionLogModel,
      OnboardingFlowModel,
      OnboardingStepEventModel,
      FormFieldInteractionEventModel,
      PermissionEventModel,
      OnboardingBehaviorSummaryModel,
      OnDeviceComputationRunModel,
      OnDeviceMetricValueModel,
      CustomerActivitySummaryModel,
      CustomerObservationModel,
      OperationalAuditLogModel,
    ]),
    CustomersModule,
  ],
  controllers: [CustomerTelemetryController],
  providers: [CustomerTelemetryService, CustomerTelemetryRepository],
})
export class CustomerTelemetryModule {}
