/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { CreditApplicationEventModel, CreditApplicationModel, CreditProductModel } from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { CreditApplicationService } from './application/credit-application.service.js';
import { CreditDecisionService } from './application/credit-decision.service.js';
import { CreditProductService } from './application/credit-product.service.js';
import { CreditOperationsController } from './credit-operations.controller.js';
import { CreditController } from './credit.controller.js';
import { CreditRepository } from './credit.repository.js';

/**
 * Dominio de crédito: catálogo de productos y ciclo de vida de la solicitud.
 *
 * Depende de `CustomersModule` únicamente por `CustomerEligibilityService`: la creación de una
 * solicitud reevalúa la elegibilidad en el servidor antes de escribir nada, y esa es la garantía
 * real de que un cliente incompleto no puede pedir crédito.
 */
@Module({
  imports: [SequelizeModule.forFeature([CreditProductModel, CreditApplicationModel, CreditApplicationEventModel]), CustomersModule],
  controllers: [CreditController, CreditOperationsController],
  providers: [CreditRepository, CreditProductService, CreditApplicationService, CreditDecisionService],
  exports: [CreditRepository],
})
export class CreditModule {}
