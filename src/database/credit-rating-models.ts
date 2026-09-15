/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system agrupa los modelos del motor de calificación para registrarlos como un bloque.
 */
import { CustomerRiskRatingModel, LoanRiskRatingModel, RatingPolicyBandModel, RatingPolicyVersionModel } from './models/index.js';

/**
 * Los cuatro modelos del motor de calificación, como un bloque.
 *
 * Mismo motivo que `LOAN_BOOK_MODELS`: `sequelize.module.ts` nombra cada modelo dos veces —import y
 * registro— y cuatro tablas más lo empujaban por encima del gate de tamaño. Agrupar también dice
 * algo cierto: la matriz sin las calificaciones no califica nada, y una calificación sin su matriz
 * no se puede reproducir. Se registran juntas o no se registra ninguna.
 */
export const CREDIT_RATING_MODELS = [
  RatingPolicyVersionModel,
  RatingPolicyBandModel,
  LoanRiskRatingModel,
  CustomerRiskRatingModel,
] as const;
