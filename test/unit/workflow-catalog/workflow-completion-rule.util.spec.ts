import { describe, expect, it } from '@jest/globals';
import type { EligibilityAssessment } from '../../../src/modules/customers/application/customer-eligibility.evaluator.js';
import { resolveStageProgress } from '../../../src/modules/workflow-catalog/application/workflow-completion-rule.util.js';

function assessment(overrides: Partial<EligibilityAssessment> = {}): EligibilityAssessment {
  return {
    eligible: false,
    lifecycleStatus: 'onboarding_in_progress',
    ruleVersion: 'eligibility-v1',
    sections: [
      { code: 'contact_verification', status: 'completed', missingFields: [] },
      { code: 'address', status: 'pending', missingFields: ['address'] },
    ],
    completionPercentage: 50,
    canSubmit: false,
    nextStep: 'address',
    blockers: [{ code: 'ADDRESS_MISSING' }],
    ...overrides,
  } as EligibilityAssessment;
}

describe('resolveStageProgress', () => {
  it('marca todo como bloqueado cuando el ciclo de vida impide operar', () => {
    for (const status of ['blocked', 'rejected', 'closed'] as const) {
      const result = resolveStageProgress(
        { type: 'onboarding_section', sectionCode: 'contact_verification' },
        assessment({ lifecycleStatus: status }),
      );
      expect(result).toEqual({ status: 'blocked', reason: `LIFECYCLE_STATUS_${status.toUpperCase()}` });
    }
  });

  describe('onboarding_section', () => {
    it('completa la etapa si la sección homónima está completa', () => {
      const result = resolveStageProgress({ type: 'onboarding_section', sectionCode: 'contact_verification' }, assessment());
      expect(result).toEqual({ status: 'completed', reason: null });
    });

    it('reporta los campos faltantes cuando la sección no está completa', () => {
      const result = resolveStageProgress({ type: 'onboarding_section', sectionCode: 'address' }, assessment());
      expect(result).toEqual({ status: 'pending', reason: 'MISSING_address' });
    });

    it('no da por cumplida una sección que la evaluación no conoce', () => {
      const result = resolveStageProgress({ type: 'onboarding_section', sectionCode: 'inventada' }, assessment());
      expect(result).toEqual({ status: 'pending', reason: 'UNKNOWN_SECTION_inventada' });
    });
  });

  describe('lifecycle_status', () => {
    it('completa la etapa si el cliente ya alcanzó alguno de los estados declarados', () => {
      const result = resolveStageProgress(
        { type: 'lifecycle_status', statuses: ['under_review', 'active'] },
        assessment({ lifecycleStatus: 'active' }),
      );
      expect(result).toEqual({ status: 'completed', reason: null });
    });

    it('deja pendiente y nombra los estados requeridos si todavía no llegó', () => {
      const result = resolveStageProgress({ type: 'lifecycle_status', statuses: ['active'] }, assessment());
      expect(result).toEqual({ status: 'pending', reason: 'REQUIRES_STATUS_active' });
    });

    it('ignora entradas no textuales del arreglo de estados', () => {
      const result = resolveStageProgress(
        { type: 'lifecycle_status', statuses: [42, null, 'active'] },
        assessment({ lifecycleStatus: 'active' }),
      );
      expect(result.status).toBe('completed');
    });
  });

  describe('no_blockers', () => {
    it('completa la etapa cuando ninguno de los bloqueadores vigilados está activo', () => {
      const result = resolveStageProgress({ type: 'no_blockers', blockerCodes: ['RISK_NOT_APPROVED'] }, assessment());
      expect(result).toEqual({ status: 'completed', reason: null });
    });

    it('enumera los bloqueadores activos que impiden cerrar la etapa', () => {
      const result = resolveStageProgress({ type: 'no_blockers', blockerCodes: ['ADDRESS_MISSING', 'RISK_NOT_APPROVED'] }, assessment());
      expect(result).toEqual({ status: 'pending', reason: 'ACTIVE_BLOCKERS_ADDRESS_MISSING' });
    });
  });

  it('reporta las etapas manuales como no aplicables, no como pendientes del cliente', () => {
    expect(resolveStageProgress({ type: 'manual' }, assessment())).toEqual({ status: 'not_applicable', reason: 'MANUAL_STAGE' });
  });

  it('nunca da por completada una etapa sin regla o con una regla desconocida', () => {
    expect(resolveStageProgress({}, assessment())).toEqual({ status: 'pending', reason: 'NO_COMPLETION_RULE' });
    expect(resolveStageProgress({ type: 'inventada' }, assessment())).toEqual({ status: 'pending', reason: 'NO_COMPLETION_RULE' });
  });
});
