/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Module } from '@nestjs/common';
import { externalProviderProviders } from './infrastructure/external-provider.providers.js';
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
import { AdminExternalProvidersController, ExternalDataController } from './external-data.controller.js';
// Fase 2.2 del plan 10/10: los verticales salieron de `external-data.controller.ts` (966 líneas, 9
// clases) a `controllers/`. El ORDEN de registro se conserva idéntico al original a propósito: Nest
// resuelve las rutas en orden de registro y cambiarlo podría alterar el matching.
import { BureauExternalDataController, KycExternalDataController } from './controllers/kyc-bureau.controller.js';
import { PaymentsExternalDataController, TelcoExternalDataController } from './controllers/payments-telco.controller.js';
import {
  DigitalTrustExternalDataController,
  FacebookExternalDataController,
  WhatsappExternalDataController,
} from './controllers/social-trust.controller.js';
import { ProviderAuthAdminController } from './controllers/provider-auth.controller.js';
import { ExternalProvidersDashboardController } from './controllers/external-providers-dashboard.controller.js';
import { AuthBrokerClient } from './infrastructure/auth-broker/auth-broker.client.js';
import { ExternalDataRepository } from './external-data.repository.js';
import { ExternalDataService } from './external-data.service.js';
import { ExternalDataDecisionService } from './application/external-data-decision.service.js';
import { ExternalDataEvidenceService } from './application/external-data-evidence.service.js';
import { ExternalDataExecutionService } from './application/external-data-execution.service.js';
import { ExternalDataGovernanceService } from './application/external-data-governance.service.js';
import { ExternalProviderRegistryService } from './application/external-provider-registry.service.js';
import { ExternalProviderConvenienceService } from './application/external-provider-convenience.service.js';
import { BankingQrService } from './application/banking-qr.service.js';
import { ExternalProviderDashboardService } from './application/external-provider-dashboard.service.js';
import { ExternalProviderDashboardRepository } from './infrastructure/external-provider-dashboard.repository.js';
import { ExternalDataPreviewService } from './application/external-data-preview.service.js';

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
    // Se registra después del controller de administración por la misma razón que el resto: Nest
    // resuelve rutas en orden de registro. Sus rutas (`auth-state`, `credentials/*`) no colisionan
    // con ninguna existente — el controller de administración no declara ningún `@Get(':providerCode')`
    // de un solo segmento que pudiera capturarlas.
    ProviderAuthAdminController,
    // Sus rutas (`dashboard`, `requests`) son de UN solo segmento y el controller de administración
    // no declara ningún `@Get(':providerCode')` de un segmento, así que no las captura. Va después
    // por coherencia con el resto y porque no hay ambigüedad que resolver por orden.
    ExternalProvidersDashboardController,
    KycExternalDataController,
    BureauExternalDataController,
    PaymentsExternalDataController,
    TelcoExternalDataController,
    FacebookExternalDataController,
    WhatsappExternalDataController,
    DigitalTrustExternalDataController,
  ],
  providers: [
    ExternalDataPreviewService,
    ExternalDataRepository,
    ExternalDataService,
    AuthBrokerClient,
    // AT-042: los adaptadores y sus alias se ensamblan en infraestructura; el registro recibe la colección.
    ...externalProviderProviders,
    ExternalProviderRegistryService,
    ExternalDataEvidenceService,
    ExternalDataDecisionService,
    ExternalDataExecutionService,
    ExternalDataGovernanceService,
    ExternalProviderConvenienceService,
    BankingQrService,
    ExternalProviderDashboardService,
    ExternalProviderDashboardRepository,
  ],
  exports: [ExternalDataService],
})
export class ExternalDataModule {}
