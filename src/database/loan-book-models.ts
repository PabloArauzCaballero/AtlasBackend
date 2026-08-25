/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system agrupa los modelos del libro de préstamos para registrarlos como un bloque.
 */
import {
  BankStatementReviewModel,
  CreditLineModel,
  DecisionSubjectLinkModel,
  DelinquencyPolicyModel,
  LoanEventModel,
  LoanInstallmentModel,
  LoanModel,
  LoanOutcomeReportModel,
  LoanPaymentAllocationModel,
  LoanPaymentClaimModel,
  LoanPaymentModel,
} from './models/index.js';

/**
 * Los ocho modelos del libro de préstamos, como un bloque.
 *
 * Se agrupan aquí y no se listan uno a uno en `sequelize.module.ts` porque ese archivo enumera cada
 * modelo DOS veces —import y registro— y siete tablas nuevas lo empujaban por encima del gate de
 * tamaño. Agrupar por dominio también dice algo cierto: estas siete se registran juntas o no se
 * registra ninguna, porque un préstamo sin cuotas o sin cola de desenlaces no es un estado válido.
 */
export const LOAN_BOOK_MODELS = [
  // La linea de credito se registra con el libro: es lo que autoriza a que existan prestamos, y
  // ambos se consultan juntos cada vez que alguien pregunta «cuanto me queda».
  CreditLineModel,
  BankStatementReviewModel,
  LoanModel,
  LoanInstallmentModel,
  LoanPaymentModel,
  LoanPaymentAllocationModel,
  // El aviso de pago del cliente esperando que el comercio lo confirme. Va con el libro porque
  // verificarlo produce un `LoanPaymentModel`: separarlos dejaria la mitad de ese flujo sin modelo.
  LoanPaymentClaimModel,
  LoanEventModel,
  LoanOutcomeReportModel,
  DecisionSubjectLinkModel,
  // La política de mora vigente: lo que se le prometió al cliente que pasaría si se atrasa.
  DelinquencyPolicyModel,
] as const;
