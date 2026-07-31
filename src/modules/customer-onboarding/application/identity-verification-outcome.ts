/**
 * Traducción del resultado del proveedor de identidad al vocabulario del onboarding.
 *
 * Se aísla como función pura porque es la decisión más delicada del flujo automático: convierte lo
 * que dice un registro externo en el valor de `identity_verification_attempts.final_result`, que la
 * regla de habilitación consume como condición C9.
 *
 * El contrato de entrada es el que emite el proveedor (y que el mock reproduce exactamente):
 * `status` ∈ `FOUND` | `PARTIAL_MATCH` | `NOT_FOUND` | `DATA_NOT_AVAILABLE` | `PROVIDER_UNAVAILABLE`
 * | `FAILED`, más `manualReviewRequired`.
 */

export type IdentityProviderResult = {
  status: string;
  manualReviewRequired?: boolean;
  reasonCode?: string | null;
};

export type IdentityOutcome = {
  /** Valor que se persiste en `identity_verification_attempts.final_result`. */
  finalResult: 'verified' | 'rejected' | 'pending_review';
  /** Si la evidencia documental puede darse por buena. Solo cuando el proveedor confirma. */
  resolvesEvidence: boolean;
  /** Si el caso queda esperando a una persona. */
  requiresManualReview: boolean;
  reasonCode: string;
};

/** Estados de proveedor que representan una falla de disponibilidad, no un juicio sobre el cliente. */
const UNAVAILABLE_STATUSES = new Set(['PROVIDER_UNAVAILABLE', 'DATA_NOT_AVAILABLE', 'FAILED', 'RATE_LIMITED', 'UNAUTHORIZED']);

export function resolveIdentityOutcome(result: IdentityProviderResult): IdentityOutcome {
  const status = (result.status ?? '').toUpperCase();

  // El proveedor no pudo responder. NO es un rechazo del cliente: se deja pendiente para que un
  // analista o un reintento lo resuelvan. Tratar una caída del proveedor como "identidad inválida"
  // castigaría al cliente por un problema de infraestructura ajeno.
  if (UNAVAILABLE_STATUSES.has(status)) {
    return {
      finalResult: 'pending_review',
      resolvesEvidence: false,
      requiresManualReview: true,
      reasonCode: result.reasonCode ?? `identity_provider_unavailable_${status.toLowerCase()}`,
    };
  }

  // El documento no existe en el registro estatal: es un rechazo real y verificable.
  if (status === 'NOT_FOUND') {
    return {
      finalResult: 'rejected',
      resolvesEvidence: false,
      requiresManualReview: false,
      reasonCode: 'identity_document_not_found',
    };
  }

  // Coincidencia parcial: el documento existe pero algún dato no cuadra. Ni aprobar ni rechazar
  // automáticamente — es exactamente el caso que justifica que exista una revisión humana.
  if (status === 'PARTIAL_MATCH') {
    return {
      finalResult: 'pending_review',
      resolvesEvidence: false,
      requiresManualReview: true,
      reasonCode: 'identity_partial_match',
    };
  }

  if (status === 'FOUND') {
    // El proveedor puede confirmar el documento y aun así pedir revisión (señal de fraude, dato
    // dudoso). Se respeta esa señal en vez de aprobar por el `status` a secas.
    if (result.manualReviewRequired === true) {
      return {
        finalResult: 'pending_review',
        resolvesEvidence: false,
        requiresManualReview: true,
        reasonCode: 'identity_found_manual_review_flagged',
      };
    }
    return {
      finalResult: 'verified',
      resolvesEvidence: true,
      requiresManualReview: false,
      reasonCode: 'identity_verified_by_provider',
    };
  }

  // Estado desconocido: se degrada a revisión manual, nunca a verificado. Un proveedor que empieza
  // a devolver un valor nuevo no puede habilitar clientes por omisión.
  return {
    finalResult: 'pending_review',
    resolvesEvidence: false,
    requiresManualReview: true,
    reasonCode: `identity_unknown_provider_status_${status.toLowerCase() || 'empty'}`,
  };
}
