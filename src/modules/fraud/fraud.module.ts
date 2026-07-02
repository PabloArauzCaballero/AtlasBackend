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
import { FraudRepository } from './fraud.repository.js';
import { FraudService } from './fraud.service.js';

/**
 * ATLAS-AUDIT-014 (cerrado en este patch): módulo `fraud` independiente de `risk`/`operations`.
 * No expone su propio `@Controller` — la ruta HTTP sigue viviendo en `OperationsController`
 * (`/operations/fraud-cases/:caseId/decision`) por compatibilidad de API; este módulo exporta
 * `FraudService` para que `OperationsModule` lo importe y delegue.
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
  ],
  providers: [FraudRepository, FraudService],
  exports: [FraudService],
})
export class FraudModule {}
