/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza hace exigibles los derechos de privacidad y limita el uso de datos personales.
 * @system gestiona decisiones de tratamiento y solicitudes del titular con auditoría y aislamiento por tenant.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  ConsentEventModel,
  CustomerActionLogModel,
  CustomerConsentModel,
  CustomerStatusEventModel,
  DataSubjectRequestModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { ConsentsModule } from '../consents/consents.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { CustomerPrivacyController } from './customer-privacy.controller.js';
import { CustomerPrivacyRepository } from './customer-privacy.repository.js';
import { CustomerPrivacyService } from './customer-privacy.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      CustomerConsentModel,
      ConsentEventModel,
      CustomerStatusEventModel,
      CustomerActionLogModel,
      DataSubjectRequestModel,
      OperationalAuditLogModel,
    ]),
    CustomersModule,
    ConsentsModule,
  ],
  controllers: [CustomerPrivacyController],
  providers: [CustomerPrivacyService, CustomerPrivacyRepository],
})
export class CustomerPrivacyModule {}
