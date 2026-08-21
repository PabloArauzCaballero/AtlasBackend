/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { CreditApplicationEventModel, CreditApplicationModel, CreditProductModel } from '../../database/models/index.js';
import { PartnerOnboardingModule } from '../partner-onboarding/partner-onboarding.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module.js';
import { CreditApplicationService } from './application/credit-application.service.js';
import { CreditBusinessAcceptanceService } from './application/credit-business-acceptance.service.js';
import { CreditDecisionService } from './application/credit-decision.service.js';
import { CreditProductService } from './application/credit-product.service.js';
import { MerchantCreditController } from './merchant-credit.controller.js';
import { CreditUnderwritingService } from './application/credit-underwriting.service.js';
import { CreditOperationsController } from './credit-operations.controller.js';
import { CreditController } from './credit.controller.js';
import { CreditRepository } from './credit.repository.js';

/**
 * Dominio de crédito: catálogo de productos y ciclo de vida de la solicitud.
 *
 * Depende de `CustomersModule` únicamente por `CustomerEligibilityService`: la creación de una
 * solicitud reevalúa la elegibilidad en el servidor antes de escribir nada, y esa es la garantía
 * real de que un cliente incompleto no puede pedir crédito.
 *
 * Y de `DecisionEngineModule` porque quien decide es el motor. Hasta ahora la decisión de crédito
 * era exclusivamente humana —`decidedByInternalUserId`, aprobar o rechazar a mano— mientras el
 * motor de políticas versionadas existía sin que nadie lo llamara.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([CreditProductModel, CreditApplicationModel, CreditApplicationEventModel]),
    CustomersModule,
    DecisionEngineModule,
    // El expediente del comercio: de él sale la categoría del gasto y quién debe aceptar la operación.
    PartnerOnboardingModule,
  ],
  controllers: [CreditController, CreditOperationsController, MerchantCreditController],
  providers: [
    CreditRepository,
    CreditProductService,
    CreditApplicationService,
    CreditDecisionService,
    CreditBusinessAcceptanceService,
    CreditUnderwritingService,
  ],
  exports: [CreditRepository, CreditUnderwritingService],
})
export class CreditModule {}
