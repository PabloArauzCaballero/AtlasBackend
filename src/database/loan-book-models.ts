/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system agrupa los modelos del libro de préstamos para registrarlos como un bloque.
 */
import {
  DecisionSubjectLinkModel,
  LoanEventModel,
  LoanInstallmentModel,
  LoanModel,
  LoanOutcomeReportModel,
  LoanPaymentAllocationModel,
  LoanPaymentModel,
} from './models/index.js';

/**
 * Los siete modelos del libro de préstamos, como un bloque.
 *
 * Se agrupan aquí y no se listan uno a uno en `sequelize.module.ts` porque ese archivo enumera cada
 * modelo DOS veces —import y registro— y siete tablas nuevas lo empujaban por encima del gate de
 * tamaño. Agrupar por dominio también dice algo cierto: estas siete se registran juntas o no se
 * registra ninguna, porque un préstamo sin cuotas o sin cola de desenlaces no es un estado válido.
 */
export const LOAN_BOOK_MODELS = [
  LoanModel,
  LoanInstallmentModel,
  LoanPaymentModel,
  LoanPaymentAllocationModel,
  LoanEventModel,
  LoanOutcomeReportModel,
  DecisionSubjectLinkModel,
] as const;
