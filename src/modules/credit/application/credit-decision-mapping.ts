/**
 * @file Utilidad pura: cómo se traduce el desenlace resuelto de una solicitud a lo que persiste.
 * @business Una decisión de crédito no es sólo un estado: es un expediente completo —tasa, plazo,
 *   caso de revisión, aceptación pendiente del negocio— que hay que poder reconstruir después.
 * @system arma el payload del historial y las columnas del expediente a partir del desenlace ya
 *   resuelto por `CreditUnderwritingService`, sin acceso a base ni al motor.
 */
import { DecisionResponse } from '../../decision-engine/decision-engine.types.js';
import type { ReviewCaseSource } from '../credit-review-case.constants.js';
import { pricedRateAndTier } from './credit-decision-pricing.mapper.js';

/** Dónde quedó la revisión de una solicitud: el caso que la sostiene y de quién es su bandeja. */
export type PlacedReviewCase = { code: string | null; source: ReviewCaseSource | null };

/**
 * Lo que el historial guarda de la decisión, además del estado.
 *
 * `manualReviewCaseCode` es el caso que sostiene la revisión —el del Motor si abrió alguno, o el
 * propio de Atlas—, y `manualReviewCaseSource` dice de quién es esa bandeja: con caso del Motor, la
 * decisión humana de aquí se rechaza (`CREDIT_DECISION_DELEGADA_AL_MOTOR`); con caso propio, se
 * decide aquí. Sin caso —un rechazo o una aprobación— no hay nada que delegar. Las features que el
 * catálogo prohíbe usar al decidir se informan: quien audite tiene que poder distinguir «no había
 * dato» de «había y no se podía usar».
 */
export function decisionEventPayload(
  applied: { decisionMode: string; response: DecisionResponse | null },
  excludedFeatures: Array<{ featureCode: string; reason: string }>,
  reviewCase: PlacedReviewCase,
): Record<string, unknown> {
  const pricing = pricedRateAndTier(applied.response);
  return {
    decisionMode: applied.decisionMode,
    executionId: applied.response?.executionId ?? null,
    artifactVersionId: applied.response?.artifact?.versionId ?? null,
    outcome: applied.response?.outcome ?? null,
    manualReviewCaseCode: reviewCase.code,
    manualReviewCaseSource: reviewCase.source,
    manualReviewQueueCode: applied.response?.manualReview?.queueCode ?? null,
    excludedFeatures,
    // Frente 3A: lo que el Motor tarificó para esta ejecución, para poder auditar el precio sin
    // reconstruirlo desde la respuesta cruda del motor.
    decisionPricedRate: pricing.pricedRate,
    decisionPricingTier: pricing.pricingTier,
  };
}

/**
 * Las columnas que el expediente guarda de la decisión del motor.
 *
 * Se construyen en bloque porque describen UNA decisión: escribir el estado nuevo junto al
 * `execution_id` de la anterior no falla al guardar, deja un expediente que atribuye su estado a una
 * ejecución que no lo produjo — y esa atribución es justo lo que el monitoreo del motor mide.
 *
 * `decidedAt` queda en `null` mientras el estado siga siendo `submitted`: una solicitud que aún no
 * se decidió no puede llevar fecha de decisión, y ponerla «por completitud» inventa un hecho.
 */
export function decisionColumns(
  applied: { status: string; decisionMode: string; response: DecisionResponse | null },
  subjectReference: string | null,
  now: Date,
  reviewCase: PlacedReviewCase,
) {
  const response = applied.response;
  const pricing = pricedRateAndTier(response);
  return {
    status: applied.status,
    decisionMode: applied.decisionMode,
    decisionExecutionId: response?.executionId ?? null,
    decisionArtifactVersionId: response?.artifact?.versionId ?? null,
    decisionSubjectReference: subjectReference,
    decisionScore: response?.score === null || response?.score === undefined ? null : String(response.score),
    decisionRiskBand: response?.riskBand ?? null,
    decisionReasonsJson: response?.reasonCodes ?? null,
    // Frente 3A: la tasa (porcentaje) y el tramo que decidió el Motor. `null` si no vino — el
    // desembolso cae entonces a la tasa del producto, clampeada igual (loan-disbursement.service.ts).
    decisionPricedRate: pricing.pricedRate,
    decisionPricingTier: pricing.pricingTier,
    manualReviewCaseCode: reviewCase.code,
    manualReviewCaseSource: reviewCase.source,
    decidedAt: applied.status === 'submitted' ? null : now,
    decisionValidUntil: engineValidUntil(applied),
    businessAcceptance: pendingBusinessAcceptance(applied),
    updatedAtValue: now,
  };
}

/**
 * Si esta decisión queda pendiente de que el negocio la acepte.
 *
 * El motor responde «¿este solicitante cumple los criterios de riesgo?»; el negocio responde
 * «¿queremos esta operación ahora?», que depende de cosas que el motor no mira —cupo del mes,
 * concentración en un comercio, liquidez, una campaña cerrada—. Hasta aquí la segunda pregunta no
 * se hacía: el motor aprobaba, la solicitud quedaba `approved` —estado CERRADO— y el endpoint de
 * decisión manual respondía `CREDIT_APPLICATION_ALREADY_DECIDED`. El motor no proponía: disponía.
 *
 * Sólo se marca en las del MOTOR. Una aprobación firmada por una persona ya lleva dentro la
 * voluntad del negocio, y pedir una segunda aceptación sería pedir dos veces lo mismo — el segundo
 * clic se acaba dando sin mirar.
 *
 * Vive en su propia función y no dentro de `decisionColumns` porque allí subía la complejidad del
 * mapeo por encima del tope del proyecto, y porque es una regla de negocio con nombre propio: no
 * es una columna más que se calcula, es la pregunta que faltaba.
 */
function pendingBusinessAcceptance(applied: { status: string; decisionMode: string }): string | null {
  if (applied.status !== 'approved') return null;
  return applied.decisionMode === 'decision_engine' ? 'pending' : null;
}

/** La vigencia que el motor puso a SU aprobación; la concesión usa lo primero que venza (P-11). */
function engineValidUntil(applied: { status: string; response: DecisionResponse | null }): Date | null {
  const raw = applied.status === 'approved' ? applied.response?.decisionValidUntil : null;
  return raw ? new Date(raw) : null;
}
