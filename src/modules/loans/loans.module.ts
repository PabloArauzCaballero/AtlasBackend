/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system declara el límite de inyección del libro de préstamos y sus dependencias.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  DelinquencyPolicyModel,
  LoanEventModel,
  LoanInstallmentModel,
  LoanModel,
  LoanOutcomeReportModel,
  LoanPaymentAllocationModel,
  LoanPaymentModel,
} from '../../database/models/index.js';
import { CreditModule } from '../credit/credit.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module.js';
import { PartnerOnboardingModule } from '../partner-onboarding/partner-onboarding.module.js';
import { LoanDelinquencyService } from './application/loan-delinquency.service.js';
import { LoanDisbursementService } from './application/loan-disbursement.service.js';
import { LoanPaymentService } from './application/loan-payment.service.js';
import { LoanQueryService } from './application/loan-query.service.js';
import { LoanSpendingService } from './application/loan-spending.service.js';
import { DelinquencyPolicyService } from './application/delinquency-policy.service.js';
import { SpendingReportService } from './application/spending-report.service.js';
import { LoanWriteOffService } from './application/loan-writeoff.service.js';
import { LoansOperationsController } from './loans-operations.controller.js';
import { LoansController } from './loans.controller.js';
import { LoansRepository } from './loans.repository.js';

/**
 * El libro de préstamos: desembolso, cronograma, cobros, mora, castigo y desenlaces.
 *
 * Depende de `CreditModule` porque el préstamo nace de una solicitud aprobada y hereda su decisión,
 * y de `DecisionEngineModule` porque el desenlace observado tiene que llegar al motor: sin ese
 * viaje de vuelta, el motor decide para siempre sin llegar a saber nunca si acertó.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      LoanModel,
      LoanInstallmentModel,
      LoanPaymentModel,
      LoanPaymentAllocationModel,
      LoanEventModel,
      LoanOutcomeReportModel,
      DelinquencyPolicyModel,
    ]),
    CreditModule,
    // El nombre del cliente para el informe: un documento que se ensena lleva a quien pertenece.
    CustomersModule,
    // El comercio donde nació cada crédito: de él salen el nombre y el rubro del gasto.
    PartnerOnboardingModule,
    DecisionEngineModule,
  ],
  controllers: [LoansController, LoansOperationsController],
  providers: [LoansRepository, LoanDisbursementService, LoanPaymentService, LoanWriteOffService, LoanDelinquencyService, LoanQueryService, LoanSpendingService, DelinquencyPolicyService, SpendingReportService],
  exports: [LoansRepository],
})
export class LoansModule {}
