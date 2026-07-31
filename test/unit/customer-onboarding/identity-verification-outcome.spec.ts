import { describe, expect, it } from '@jest/globals';
import { resolveIdentityOutcome } from '../../../src/modules/customer-onboarding/application/identity-verification-outcome.js';

/**
 * Traducción del veredicto del proveedor de identidad al vocabulario del onboarding.
 *
 * Es la decisión más delicada del flujo automático: convierte lo que dice un registro externo en el
 * valor de `identity_verification_attempts.final_result`, que la regla de habilitación consume como
 * condición C9. Los estados de entrada son exactamente los que emite el proveedor y que el simulador
 * (`AtlasExternalProvidersMock`) reproduce sin inventar formas nuevas.
 */
describe('resolveIdentityOutcome', () => {
  it('FOUND limpio verifica al cliente y da por buena la evidencia documental', () => {
    expect(resolveIdentityOutcome({ status: 'FOUND' })).toEqual({
      finalResult: 'verified',
      resolvesEvidence: true,
      requiresManualReview: false,
      reasonCode: 'identity_verified_by_provider',
    });
  });

  /** El proveedor puede confirmar el documento y aun así pedir revisión: se respeta esa señal. */
  it('FOUND con manualReviewRequired NO verifica: queda para una persona', () => {
    const outcome = resolveIdentityOutcome({ status: 'FOUND', manualReviewRequired: true });
    expect(outcome.finalResult).toBe('pending_review');
    expect(outcome.resolvesEvidence).toBe(false);
    expect(outcome.requiresManualReview).toBe(true);
  });

  it('NOT_FOUND es un rechazo real y verificable, no una revisión', () => {
    expect(resolveIdentityOutcome({ status: 'NOT_FOUND', manualReviewRequired: true })).toEqual({
      finalResult: 'rejected',
      resolvesEvidence: false,
      requiresManualReview: false,
      reasonCode: 'identity_document_not_found',
    });
  });

  it('PARTIAL_MATCH ni aprueba ni rechaza: es el caso que justifica la revisión humana', () => {
    const outcome = resolveIdentityOutcome({ status: 'PARTIAL_MATCH', manualReviewRequired: true });
    expect(outcome).toMatchObject({ finalResult: 'pending_review', resolvesEvidence: false, requiresManualReview: true });
  });

  /**
   * Tratar una caída del proveedor como "identidad inválida" castigaría al cliente por un problema
   * de infraestructura ajeno, y además cerraría el documento impidiendo el reintento.
   */
  it.each(['PROVIDER_UNAVAILABLE', 'DATA_NOT_AVAILABLE', 'FAILED', 'RATE_LIMITED', 'UNAUTHORIZED'])(
    '%s deja el caso pendiente, nunca rechazado',
    (status) => {
      const outcome = resolveIdentityOutcome({ status });
      expect(outcome.finalResult).toBe('pending_review');
      expect(outcome.requiresManualReview).toBe(true);
      expect(outcome.resolvesEvidence).toBe(false);
    },
  );

  it('conserva el reasonCode del proveedor cuando lo hay, para no perder el motivo original', () => {
    const outcome = resolveIdentityOutcome({ status: 'PROVIDER_UNAVAILABLE', reasonCode: 'SEGIP_TIMEOUT' });
    expect(outcome.reasonCode).toBe('SEGIP_TIMEOUT');
  });

  /** Un proveedor que empieza a devolver un valor nuevo no puede habilitar clientes por omisión. */
  it('un estado desconocido degrada a revisión manual, nunca a verificado', () => {
    const outcome = resolveIdentityOutcome({ status: 'SOMETHING_NEW' });
    expect(outcome.finalResult).toBe('pending_review');
    expect(outcome.reasonCode).toBe('identity_unknown_provider_status_something_new');

    expect(resolveIdentityOutcome({ status: '' }).finalResult).toBe('pending_review');
  });

  it('es insensible a mayúsculas/minúsculas del proveedor', () => {
    expect(resolveIdentityOutcome({ status: 'found' }).finalResult).toBe('verified');
    expect(resolveIdentityOutcome({ status: 'not_found' }).finalResult).toBe('rejected');
  });
});
