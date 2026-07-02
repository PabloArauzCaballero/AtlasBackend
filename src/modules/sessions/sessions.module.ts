import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AddressGpsObservationModel,
  AuthEventModel,
  CustomerActionLogModel,
  CustomerActivitySummaryModel,
  CustomerAddressModel,
  CustomerAddressVersionModel,
  CustomerDeviceLinkModel,
  CustomerObservationModel,
  CustomerSessionModel,
  DeviceModel,
  DeviceRiskEventModel,
  DeviceSnapshotModel,
  GlobalDeviceFingerprintModel,
  IpReputationObservationModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
  PermissionEventModel,
  SimObservationModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { CustomerSessionsController, OperationsSessionsController } from './sessions.controller.js';
import { SessionsRepository } from './sessions.repository.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      GlobalDeviceFingerprintModel,
      DeviceModel,
      CustomerDeviceLinkModel,
      CustomerSessionModel,
      DeviceSnapshotModel,
      AddressGpsObservationModel,
      PermissionEventModel,
      AuthEventModel,
      IpReputationObservationModel,
      SimObservationModel,
      DeviceRiskEventModel,
      CustomerActionLogModel,
      CustomerActivitySummaryModel,
      CustomerObservationModel,
      OnboardingFlowModel,
      OnboardingStepEventModel,
      OperationalAuditLogModel,
      CustomerAddressModel,
      CustomerAddressVersionModel,
    ]),
    CustomersModule,
  ],
  controllers: [CustomerSessionsController, OperationsSessionsController],
  providers: [SessionsRepository, SessionsService],
  exports: [SessionsRepository, SessionsService],
})
export class SessionsModule {}
