import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerObservationModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseEventModel,
  FraudCaseModel,
  OperationalAuditLogModel,
  WatchlistEntryModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { FraudRepository } from './fraud.repository.js';
import { FraudService } from './fraud.service.js';

/**
 * Módulo de fraude independiente de `risk` y `operations`.
 *
 * No expone controller propio; `OperationsController` conserva la ruta compatible y delega aquí.
 * `CustomersModule` permite resolver hashes reales de teléfono/email al aplicar watchlist.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      FraudCaseModel,
      FraudCaseEventModel,
      WatchlistEntryModel,
      CustomerStatusEventModel,
      CustomerObservationModel,
      OperationalAuditLogModel,
      DataChangeLogModel,
    ]),
    CustomersModule,
  ],
  providers: [FraudRepository, FraudService],
  exports: [FraudService],
})
export class FraudModule {}
