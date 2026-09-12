/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system traduce filas de calificación a respuestas estables, con importes como texto exacto.
 */
import { CustomerRiskRatingModel, LoanRiskRatingModel } from '../../database/models/index.js';
import type { PortfolioGradeRow } from './credit-rating.repository.js';

/**
 * Los importes salen como TEXTO, igual que entran.
 *
 * Convertirlos a `number` para la respuesta reintroduce en el borde de salida el error de precisión
 * que todo el módulo evita por dentro: un saldo de 12345.67 serializado como flotante puede llegar
 * al consumidor con un céntimo distinto al que hay en la base, y ese consumidor lo cuadra contra
 * contabilidad.
 */
export function toLoanRatingResponse(rating: LoanRiskRatingModel) {
  return {
    id: String(rating.id),
    loanId: String(rating.loanId),
    customerId: String(rating.customerId),
    policyVersionId: String(rating.policyVersionId),
    grade: rating.grade,
    gradeLabel: rating.gradeLabel,
    severityRank: rating.severityRank,
    daysPastDue: rating.daysPastDue,
    delinquencyBucket: rating.delinquencyBucket,
    exposureAmount: rating.exposureAmount,
    provisionRate: rating.provisionRate,
    provisionAmount: rating.provisionAmount,
    previousGrade: rating.previousGrade,
    ratingReason: rating.ratingReason,
    isCurrent: rating.isCurrent,
    ratedAt: rating.ratedAt.toISOString(),
  };
}

export function toCustomerRatingResponse(rating: CustomerRiskRatingModel) {
  return {
    id: String(rating.id),
    customerId: String(rating.customerId),
    policyVersionId: String(rating.policyVersionId),
    grade: rating.grade,
    gradeLabel: rating.gradeLabel,
    severityRank: rating.severityRank,
    worstDaysPastDue: rating.worstDaysPastDue,
    ratedLoanCount: rating.ratedLoanCount,
    totalExposureAmount: rating.totalExposureAmount,
    totalProvisionAmount: rating.totalProvisionAmount,
    drivingLoanId: rating.drivingLoanId === null ? null : String(rating.drivingLoanId),
    previousGrade: rating.previousGrade,
    ratingReason: rating.ratingReason,
    isCurrent: rating.isCurrent,
    ratedAt: rating.ratedAt.toISOString(),
  };
}

/**
 * Fila de la distribución de cartera.
 *
 * `SUM` sobre un grupo vacío devuelve `NULL` en Postgres, no cero. Se normaliza aquí porque el
 * consumidor de esta respuesta la suma para el cierre, y un `null` en medio de esa suma la convierte
 * en `NaN` sin decir dónde se rompió.
 */
export function toPortfolioGradeResponse(row: PortfolioGradeRow) {
  return {
    grade: row.grade,
    gradeLabel: row.gradeLabel,
    severityRank: Number(row.severityRank),
    loanCount: Number(row.loanCount),
    exposureAmount: row.exposureAmount ?? '0.00',
    provisionAmount: row.provisionAmount ?? '0.00',
  };
}
