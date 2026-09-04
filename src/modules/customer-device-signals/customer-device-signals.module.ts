/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza agrupa las señales que el dispositivo entrega con permiso explícito: agenda y ubicación.
 * @system registra los modelos, repositorios y servicios de la sincronización de agenda y del rastreo.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AddressGpsObservationModel,
  CustomerConsentModel,
  CustomerDeviceContactModel,
  CustomerDeviceLinkModel,
  CustomerLocationPingModel,
  CustomerSessionModel,
  OnDeviceComputationRunModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { CustomerAddressBookService } from './application/customer-address-book.service.js';
import { CustomerLocationTrackingService } from './application/customer-location-tracking.service.js';
import { DeviceSignalsAccessService } from './application/device-signals-access.service.js';
import { CustomerDeviceSignalsController } from './customer-device-signals.controller.js';
import { CustomerDeviceContactsRepository } from './repositories/customer-device-contacts.repository.js';
import { CustomerLocationPingsRepository } from './repositories/customer-location-pings.repository.js';
import { DeviceSignalsJournalRepository } from './repositories/device-signals-journal.repository.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      CustomerDeviceContactModel,
      CustomerLocationPingModel,
      OnDeviceComputationRunModel,
      CustomerDeviceLinkModel,
      CustomerSessionModel,
      CustomerConsentModel,
      AddressGpsObservationModel,
      OnboardingFlowModel,
      OnboardingStepEventModel,
      OperationalAuditLogModel,
    ]),
    CustomersModule,
  ],
  controllers: [CustomerDeviceSignalsController],
  providers: [
    CustomerAddressBookService,
    CustomerLocationTrackingService,
    DeviceSignalsAccessService,
    CustomerDeviceContactsRepository,
    CustomerLocationPingsRepository,
    DeviceSignalsJournalRepository,
  ],
  exports: [CustomerAddressBookService, CustomerLocationTrackingService],
})
export class CustomerDeviceSignalsModule {}
