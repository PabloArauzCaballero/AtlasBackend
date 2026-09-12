/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system valida e ingiere lotes de telemetría con límites, redacción y escritura transaccional.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AuthEventModel,
  CustomerActionLogModel,
  CustomerActivitySummaryModel,
  CustomerDeviceLinkModel,
  CustomerObservationModel,
  CustomerSessionModel,
  DeviceRiskEventModel,
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
import { TelemetrySessionContextRepository } from './telemetry-session-context.repository.js';
import { TelemetryBehaviorRepository } from './telemetry-behavior.repository.js';
import { TelemetryDeviceSignalsRepository } from './telemetry-device-signals.repository.js';
import { TelemetryOnDeviceRepository } from './telemetry-on-device.repository.js';
import { TelemetryActivityRepository } from './telemetry-activity.repository.js';
import { CustomerTelemetryRepository } from './customer-telemetry.repository.js';
import { CustomerTelemetryService } from './customer-telemetry.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      CustomerDeviceLinkModel,
      CustomerSessionModel,
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
  providers: [
    CustomerTelemetryService,
    CustomerTelemetryRepository,
    TelemetrySessionContextRepository,
    TelemetryBehaviorRepository,
    TelemetryDeviceSignalsRepository,
    TelemetryOnDeviceRepository,
    TelemetryActivityRepository,
  ],
})
export class CustomerTelemetryModule {}
