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
import { SessionsActivityAuditRepository } from './repositories/sessions-activity-audit.repository.js';
import { SessionsDeviceRepository } from './repositories/sessions-device.repository.js';
import { SessionsLifecycleRepository } from './repositories/sessions-lifecycle.repository.js';
import { SessionsLocationRepository } from './repositories/sessions-location.repository.js';
import { SessionsOnboardingLinkRepository } from './repositories/sessions-onboarding-link.repository.js';
import { SessionsTelemetryRepository } from './repositories/sessions-telemetry.repository.js';
import { SessionsRepository } from './sessions.repository.js';
import { SessionsService } from './sessions.service.js';
import { SessionEndService } from './application/session-end.service.js';
import { SessionGpsWriterService } from './application/session-gps-writer.service.js';
import { SessionHeartbeatService } from './application/session-heartbeat.service.js';
import { SessionQueryService } from './application/session-query.service.js';
import { SessionStartService } from './application/session-start.service.js';

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
  providers: [
    SessionsDeviceRepository,
    SessionsLifecycleRepository,
    SessionsLocationRepository,
    SessionsTelemetryRepository,
    SessionsOnboardingLinkRepository,
    SessionsActivityAuditRepository,
    SessionsRepository,
    SessionGpsWriterService,
    SessionStartService,
    SessionHeartbeatService,
    SessionEndService,
    SessionQueryService,
    SessionsService,
  ],
  exports: [SessionsRepository, SessionsService],
})
export class SessionsModule {}
