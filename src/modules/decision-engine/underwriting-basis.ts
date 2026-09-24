/**
 * @file Utilidad de dominio: la base habilitante con la que Core pide una decisión de crédito (P-09).
 * @business El motor no decide sin base registrada; Core la registra ANTES de preguntar y, si no
 *   llega, no pregunta: la solicitud queda para reintentar, nunca rechazada.
 * @system fija finalidad y base, y traduce el estado de la réplica a «se puede decidir o no».
 */
import type { BasisReadiness, ConsentBasis, EngineConsentGateway } from './engine-consent.gateway.js';
import { CREDIT_DECISION_PURPOSE } from './subject-reference.service.js';

/**
 * La base con la que Core ampara la evaluación crediticia: `CREDIT_PROTECTION`.
 *
 * El alta del cliente captura tres consentimientos obligatorios —`terms_of_service`,
 * `privacy_policy` y `credit_bureau_query`— y ninguno es un consentimiento específico para
 * `credit_underwriting`: el de buró cubre CONSULTAR centrales, no evaluar. Registrar `CONSENT` sería
 * atribuir al titular un consentimiento que no dio. La evaluación se hace porque el cliente PIDIÓ el
 * crédito (base contractual/protección del crédito), que es además la base que el motor acepta por
 * defecto en originación. Sin versión de texto: no hay texto consentido que versionar. Lo ratifica J
 * (docs/compliance/decisions.md, P-09 · Core ↔ Motor).
 */
export const UNDERWRITING_BASIS: ConsentBasis = 'CREDIT_PROTECTION';

export function ensureUnderwritingBasis(
  consents: EngineConsentGateway,
  input: { tenantId: string; customerId: string; subjectReference: string; now: Date },
): Promise<BasisReadiness> {
  return consents.ensureGranted({ ...input, purpose: CREDIT_DECISION_PURPOSE, basis: UNDERWRITING_BASIS, consentVersion: null });
}

/**
 * Qué hacer con la solicitud según la base. `ready`/`superseded` → decidir (con `superseded` el motor
 * tiene un estado más nuevo y él juzga). `unmaterialized` → decidir: es un motor anterior que no exige
 * base y no sabe registrarla antes de la primera decisión (compatibilidad de despliegue). `pending` → diferir y reintentar. `revoked` → no decidir:
 * revisión humana.
 */
export function basisBlocker(readiness: BasisReadiness): { kind: 'deferred' | 'engineUnavailable'; reason: string } | null {
  if (readiness.status === 'ready' || readiness.status === 'superseded' || readiness.status === 'unmaterialized') return null;
  if (readiness.status === 'revoked') return { kind: 'engineUnavailable', reason: 'ENABLING_BASIS_REVOKED' };
  return { kind: 'deferred', reason: 'ENABLING_BASIS_NOT_REPLICATED' };
}
