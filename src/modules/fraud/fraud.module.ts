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
 * ATLAS-AUDIT-014 (cerrado en este patch): módulo `fraud` independiente de `risk`/`operations`.
 * No expone su propio `@Controller` — la ruta HTTP sigue viviendo en `OperationsController`
 * (`/operations/fraud-cases/:caseId/decision`) por compatibilidad de API; este módulo exporta
 * `FraudService` para que `OperationsModule` lo importe y delegue.
 *
 * Importa `CustomersModule` (auditoría de producción — ver docs/audit/fraud.md) para que
 * `FraudService` pueda resolver los hashes reales de teléfono/email del cliente al aplicar un
 * watchlist, en vez de hashear el `customerId` interno (que nunca puede volver a coincidir con
 * el registro de un futuro cliente).
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
