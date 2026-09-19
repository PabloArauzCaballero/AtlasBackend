/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system agrupa matriz versionada, motor de calificación y lectura de cartera.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerRiskRatingModel,
  LoanModel,
  LoanRiskRatingModel,
  RatingPolicyBandModel,
  RatingPolicyVersionModel,
} from '../../database/models/index.js';
import { DebtRatingService } from './application/debt-rating.service.js';
import { RatingPolicyService } from './application/rating-policy.service.js';
import { RatingQueryService } from './application/rating-query.service.js';
import { CreditRatingController } from './credit-rating.controller.js';
import { CreditRatingOperationsController } from './credit-rating-operations.controller.js';
import { CreditRatingRepository } from './credit-rating.repository.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      RatingPolicyVersionModel,
      RatingPolicyBandModel,
      LoanRiskRatingModel,
      CustomerRiskRatingModel,
      // El libro de préstamos es la ENTRADA del motor: se lee para calificar, nunca se escribe desde
      // aquí. La calificación es un juicio derivado del préstamo y no puede alterarlo.
      LoanModel,
    ]),
  ],
  controllers: [CreditRatingController, CreditRatingOperationsController],
  providers: [CreditRatingRepository, RatingPolicyService, RatingQueryService, DebtRatingService],
  exports: [DebtRatingService, RatingQueryService],
})
export class CreditRatingModule {}
