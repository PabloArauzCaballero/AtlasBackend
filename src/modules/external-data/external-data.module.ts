import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerConsentModel,
  CustomerObservationModel,
  DataProviderModel,
  DataProviderRequestModel,
  DataProviderResponseModel,
  ExternalProviderCostPolicyModel,
  FeatureSnapshotModel,
  ProviderHealthLogModel,
} from '../../database/models/index.js';
import {
  AdminExternalProvidersController,
  BureauExternalDataController,
  DigitalTrustExternalDataController,
  ExternalDataController,
  FacebookExternalDataController,
  KycExternalDataController,
  PaymentsExternalDataController,
  TelcoExternalDataController,
  WhatsappExternalDataController,
} from './external-data.controller.js';
import { ExternalDataRepository } from './external-data.repository.js';
import { ExternalDataService } from './external-data.service.js';
import { ExternalDataEvidenceService } from './application/external-data-evidence.service.js';
import { ExternalDataExecutionService } from './application/external-data-execution.service.js';
import { ExternalDataGovernanceService } from './application/external-data-governance.service.js';
import { ExternalProviderRegistryService } from './application/external-provider-registry.service.js';
import { ExternalProviderConvenienceService } from './application/external-provider-convenience.service.js';
import { SegipAdapter } from './infrastructure/adapters/segip/segip.adapter.js';
import { InfoCenterAdapter } from './infrastructure/adapters/infocenter/infocenter.adapter.js';
import { QrGenericAdapter } from './infrastructure/adapters/qr-generic/qr-generic.adapter.js';
import { BankingGenericAdapter } from './infrastructure/adapters/banking-generic/banking-generic.adapter.js';
import { TelcoGenericAdapter } from './infrastructure/adapters/telco-generic/telco-generic.adapter.js';
import { FacebookMetaAdapter } from './infrastructure/adapters/facebook-meta/facebook-meta.adapter.js';
import { WhatsappAdapter } from './infrastructure/adapters/whatsapp/whatsapp.adapter.js';
import { DigitalTrustGenericAdapter } from './infrastructure/adapters/digital-trust-generic/digital-trust-generic.adapter.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      DataProviderModel,
      ExternalProviderCostPolicyModel,
      CustomerConsentModel,
      DataProviderRequestModel,
      DataProviderResponseModel,
      CustomerObservationModel,
      FeatureSnapshotModel,
      ProviderHealthLogModel,
    ]),
  ],
  controllers: [
    ExternalDataController,
    AdminExternalProvidersController,
    KycExternalDataController,
    BureauExternalDataController,
    PaymentsExternalDataController,
    TelcoExternalDataController,
    FacebookExternalDataController,
    WhatsappExternalDataController,
    DigitalTrustExternalDataController,
  ],
  providers: [
    ExternalDataRepository,
    ExternalDataService,
    ExternalProviderRegistryService,
    ExternalDataEvidenceService,
    ExternalDataExecutionService,
    ExternalDataGovernanceService,
    ExternalProviderConvenienceService,
    SegipAdapter,
    InfoCenterAdapter,
    QrGenericAdapter,
    BankingGenericAdapter,
    TelcoGenericAdapter,
    FacebookMetaAdapter,
    WhatsappAdapter,
    DigitalTrustGenericAdapter,
  ],
  exports: [ExternalDataService],
})
export class ExternalDataModule {}
