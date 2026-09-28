/**
 * @file Utilidad acotada reutilizable dentro de su capa.
 * @business Lo que queda escrito cuando un extracto se rechaza o pasa a manos de una persona.
 * @system escribe sobre `BankStatementReviewModel` el desenlace del motor; la usan el barrido y la vuelta de la revisión humana.
 */
import type { BankStatementReviewModel } from '../../../database/models/index.js';
import type { StatementRun } from '../../decision-engine/bank-statement-engine.client.js';
import type { RejectionCopy } from '../domain/statement-rejection.js';

/**
 * Cierra la revisión con un motivo que la persona pueda resolver.
 *
 * Guarda las tres cosas: el código técnico con el que se busca el caso, la categoría con la que se
 * mide cuál pesa, y la frase que el cliente lee. Antes había una sola cadena y con ella la app
 * decía lo mismo tanto si el documento era una factura de la luz como si cubría un mes en vez de
 * tres.
 */
export async function closeAsRejected(
  review: BankStatementReviewModel,
  run: StatementRun | null,
  copy: RejectionCopy,
  now: Date,
): Promise<void> {
  review.status = 'rejected';
  review.rejectionReason = copy.category;
  review.rejectionCategory = copy.category;
  review.rejectionMessage = copy.message;
  review.engineRequestId = run?.requestId ?? review.engineRequestId ?? null;
  review.engineStatus = run?.status ?? null;
  review.engineErrorCode = run?.errorCode ?? run?.rejectionReason ?? null;
  review.reviewedAt = now;
  review.updatedAtValue = now;
  recordEngineFacts(review, run);
  await review.save();
}

/** Deja el caso esperando a una persona, con el motivo que dio el motor. */
export async function parkForHumanReview(review: BankStatementReviewModel, run: StatementRun, now: Date): Promise<void> {
  review.status = 'processing';
  review.engineRequestId = run.requestId;
  review.engineStatus = run.status;
  review.engineErrorCode = run.errorCode;
  review.reviewReason = run.reviewReason;
  review.reviewedAt = now;
  review.updatedAtValue = now;
  recordEngineFacts(review, run);
  await review.save();
}

/**
 * Lo que el motor observó del documento, se aplique o no.
 *
 * Se guarda también en el rechazo y en la revisión a propósito: saber que un extracto rechazado
 * venía del BNB y que su contenedor estaba limpio es lo que permite después preguntar «¿de qué
 * bancos llegan los documentos que no sabemos leer?», que es la pregunta con la que se decide qué
 * analizador escribir a continuación.
 */
export function recordEngineFacts(review: BankStatementReviewModel, run: StatementRun | null): void {
  const result = run?.result;
  if (!result) return;
  review.institutionCode = result.institution?.id ?? null;
  review.institutionName = result.institution?.name ?? null;
  review.authenticityVerdict = result.authenticity?.verdict ?? null;
  review.authenticityScore = result.authenticity?.suspicionScore ?? null;
  review.periodFrom = result.period?.from ?? null;
  review.periodTo = result.period?.to ?? null;
  const affordability = result.affordability;
  if (!affordability) return;
  review.affordabilityJson = affordability as unknown as Record<string, unknown>;
  review.affordabilityEligible = affordability.eligible ?? false;
  review.monthsComplete = affordability.coverage?.monthsComplete ?? null;
}
