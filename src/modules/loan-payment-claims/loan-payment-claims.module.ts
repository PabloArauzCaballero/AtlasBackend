/**
 * @file Módulo Nest: agrupa el caso de uso del aviso de pago y su verificación.
 * @business Conecta al cliente que dice haber pagado con el comercio que lo comprueba.
 * @system reutiliza el registro de pagos de préstamos en vez de reimplementar el reparto.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { EvidenceDocumentModel, LoanPaymentClaimModel } from '../../database/models/index.js';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import { MalwareScannerService } from '../../common/storage/malware-scanner.service.js';
import { CreditModule } from '../credit/credit.module.js';
import { EventsModule } from '../events/events.module.js';
import { LoansModule } from '../loans/loans.module.js';
import { PartnerOnboardingModule } from '../partner-onboarding/partner-onboarding.module.js';
import { LoanPaymentClaimsService } from './loan-payment-claims.service.js';
import { MerchantPaymentClaimsController } from './merchant-payment-claims.controller.js';
import { MobilePaymentClaimsController } from './mobile-payment-claims.controller.js';

@Module({
  imports: [
    SequelizeModule.forFeature([LoanPaymentClaimModel, EvidenceDocumentModel]),
    CreditModule,
    EventsModule,
    LoansModule,
    PartnerOnboardingModule,
  ],
  controllers: [MobilePaymentClaimsController, MerchantPaymentClaimsController],
  /*
   * `DocumentStorageService` se PROVEE aqui, no se importa: `CustomerOnboardingModule` lo declara
   * pero no lo exporta, y es un servicio sin estado —solo firma URLs contra la configuracion—, asi
   * que una segunda instancia no divide nada. Es lo que ya hacen credit y partner-onboarding.
   */
  providers: [LoanPaymentClaimsService, DocumentStorageService, MalwareScannerService],
  exports: [LoanPaymentClaimsService],
})
export class LoanPaymentClaimsModule {}
