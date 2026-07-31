import { describe, expect, it } from '@jest/globals';
import {
  assess,
  buildBlockers,
  buildSections,
  calculateAgeInYears,
  isAgeAcceptable,
} from '../../../src/modules/customers/application/customer-eligibility.evaluator.js';
import { EligibilityFacts } from '../../../src/modules/customers/repositories/customer-eligibility.repository.js';

/**
 * Regla técnica de habilitación crediticia.
 *
 * Antes NO existía: el sistema no tenía forma de responder "¿este cliente puede pedir un crédito?".
 * Lo más cercano era `risk_assessment_results.recommended_action`, que ni se reflejaba en el estado
 * del cliente ni bloqueaba nada. Estos tests fijan el contrato de la regla: qué la bloquea, qué la
 * habilita, y que NUNCA corte en el primer bloqueador (el frontend necesita la lista completa para
 * decirle al cliente todo lo que le falta de una sola vez).
 */
const NOW = new Date('2026-07-28T12:00:00.000Z');

function eligibleFacts(overrides: Partial<EligibilityFacts> = {}): EligibilityFacts {
  return {
    hasCredentials: true,
    verifiedContactCount: 1,
    profile: { id: 1, firstName: 'Ana', lastName: 'Paz', birthDate: '1990-01-01' } as never,
    presentFinancialAttributeCodes: [
      'employment_status',
      'employment_seniority_months',
      'monthly_income_declared',
      'monthly_expenses_declared',
      'economic_activity_code',
      'source_of_funds',
    ],
    hasCurrentAddress: true,
    referenceContactCount: 2,
    identityDocument: { id: 9, expiresAt: '2030-01-01' } as never,
    identityVerificationResult: 'verified',
    pendingEvidenceReviewCount: 0,
    grantedConsentDocumentIds: ['1', '2'],
    requiredConsentDocumentIds: ['1', '2'],
    openObservationCount: 0,
    unclearedWatchlistMatchCount: 0,
    latestRisk: { id: 4, recommendedAction: 'approved_for_next_step', decidedAt: new Date('2026-07-01T00:00:00.000Z') } as never,
    openFraudCaseCount: 0,
    ...overrides,
  };
}

describe('cálculo de edad', () => {
  it('descuenta el año cuando el cumpleaños todavía no ocurrió', () => {
    expect(calculateAgeInYears('1990-12-31', NOW)).toBe(35);
    expect(calculateAgeInYears('1990-01-01', NOW)).toBe(36);
  });

  it('rechaza menores de edad y fechas absurdas; acepta un adulto', () => {
    expect(isAgeAcceptable('2015-01-01', NOW)).toBe(false);
    expect(isAgeAcceptable('1800-01-01', NOW)).toBe(false);
    expect(isAgeAcceptable('no-es-fecha', NOW)).toBe(false);
    expect(isAgeAcceptable(null, NOW)).toBe(false);
    expect(isAgeAcceptable('1990-01-01', NOW)).toBe(true);
  });
});

describe('buildBlockers', () => {
  it('no devuelve ningún bloqueador cuando todas las condiciones se cumplen y el estado es active', () => {
    expect(buildBlockers(eligibleFacts(), 'active', NOW)).toEqual([]);
  });

  it('bloquea por estado cuando el cliente cumple todo pero todavía no está active', () => {
    const blockers = buildBlockers(eligibleFacts(), 'under_review', NOW);
    expect(blockers).toEqual([{ code: 'ACCOUNT_NOT_ACTIVE', detail: 'under_review' }]);
  });

  it('acumula TODOS los bloqueadores; no corta en el primero', () => {
    const blockers = buildBlockers(
      eligibleFacts({
        hasCredentials: false,
        verifiedContactCount: 0,
        hasCurrentAddress: false,
        referenceContactCount: 0,
      }),
      'active',
      NOW,
    );
    const codes = blockers.map((blocker) => blocker.code);
    expect(codes).toEqual(expect.arrayContaining(['NO_CREDENTIALS', 'CONTACT_NOT_VERIFIED', 'ADDRESS_MISSING', 'REFERENCES_INSUFFICIENT']));
    expect(codes.length).toBeGreaterThanOrEqual(4);
  });

  it('informa exactamente qué campos del perfil personal faltan', () => {
    const blockers = buildBlockers(
      eligibleFacts({ profile: { id: 1, firstName: null, lastName: 'Paz', birthDate: null } as never }),
      'active',
      NOW,
    );
    expect(blockers).toContainEqual({ code: 'PROFILE_INCOMPLETE', fields: ['firstName', 'birthDate'] });
  });

  it('trata como incompleto un perfil con fecha de nacimiento de un menor de edad', () => {
    const blockers = buildBlockers(
      eligibleFacts({ profile: { id: 1, firstName: 'A', lastName: 'B', birthDate: '2015-01-01' } as never }),
      'active',
      NOW,
    );
    expect(blockers).toContainEqual({ code: 'PROFILE_INCOMPLETE', fields: ['birthDate'] });
  });

  it('informa exactamente qué atributos económicos faltan', () => {
    const blockers = buildBlockers(eligibleFacts({ presentFinancialAttributeCodes: ['employment_status'] }), 'active', NOW);
    const blocker = blockers.find((item) => item.code === 'FINANCIAL_PROFILE_INCOMPLETE');
    expect(blocker?.fields).toEqual([
      'employment_seniority_months',
      'monthly_income_declared',
      'monthly_expenses_declared',
      'economic_activity_code',
      'source_of_funds',
    ]);
  });

  it('distingue documento ausente de documento vencido', () => {
    expect(buildBlockers(eligibleFacts({ identityDocument: null }), 'active', NOW).map((b) => b.code)).toContain(
      'IDENTITY_DOCUMENT_MISSING',
    );
    const expired = buildBlockers(eligibleFacts({ identityDocument: { id: 9, expiresAt: '2020-01-01' } as never }), 'active', NOW);
    expect(expired.map((b) => b.code)).toContain('IDENTITY_DOCUMENT_EXPIRED');
  });

  it('bloquea cuando falta un consentimiento obligatorio del tenant', () => {
    const blockers = buildBlockers(eligibleFacts({ grantedConsentDocumentIds: ['1'] }), 'active', NOW);
    expect(blockers).toContainEqual({ code: 'CONSENT_MISSING', fields: ['2'] });
  });

  it('bloquea por riesgo no aprobado y, por separado, por riesgo obsoleto', () => {
    const notApproved = buildBlockers(
      eligibleFacts({ latestRisk: { id: 4, recommendedAction: 'manual_review_required', decidedAt: NOW } as never }),
      'active',
      NOW,
    );
    expect(notApproved).toContainEqual({ code: 'RISK_NOT_APPROVED', detail: 'manual_review_required' });

    const stale = buildBlockers(
      eligibleFacts({
        latestRisk: { id: 4, recommendedAction: 'approved_for_next_step', decidedAt: new Date('2020-01-01T00:00:00.000Z') } as never,
      }),
      'active',
      NOW,
    );
    expect(stale.map((b) => b.code)).toContain('RISK_ASSESSMENT_STALE');
  });

  it('bloquea por cumplimiento, fraude abierto y evidencia sin revisar', () => {
    const codes = buildBlockers(
      eligibleFacts({ unclearedWatchlistMatchCount: 1, openFraudCaseCount: 1, pendingEvidenceReviewCount: 2, openObservationCount: 1 }),
      'active',
      NOW,
    ).map((blocker) => blocker.code);
    expect(codes).toEqual(
      expect.arrayContaining(['COMPLIANCE_MATCH_PENDING', 'FRAUD_CASE_OPEN', 'EVIDENCE_PENDING_REVIEW', 'OPEN_OBSERVATIONS']),
    );
  });
});

describe('buildSections y assess', () => {
  it('marca todas las secciones completas y permite enviar cuando no falta nada', () => {
    const result = assess(eligibleFacts(), 'onboarding_in_progress', NOW);
    expect(result.sections.every((section) => section.status === 'completed')).toBe(true);
    expect(result.completionPercentage).toBe(100);
    expect(result.canSubmit).toBe(true);
  });

  it('distingue una sección intacta (pending) de una a medias (in_progress)', () => {
    const sections = buildSections(
      eligibleFacts({
        profile: { id: 1, firstName: 'Ana', lastName: null, birthDate: null } as never,
        presentFinancialAttributeCodes: [],
      }),
      NOW,
    );
    expect(sections.find((s) => s.code === 'personal_data')?.status).toBe('in_progress');
    expect(sections.find((s) => s.code === 'financial_profile')?.status).toBe('pending');
  });

  it('nextStep apunta a la PRIMERA sección incompleta, que es donde el cliente debe retomar', () => {
    const result = assess(eligibleFacts({ hasCurrentAddress: false, referenceContactCount: 0 }), 'onboarding_in_progress', NOW);
    expect(result.nextStep).toBe('address');
    expect(result.canSubmit).toBe(false);
  });

  it('un cliente observado va a resolver observaciones, y uno bloqueado no va a ninguna parte', () => {
    expect(assess(eligibleFacts(), 'observed', NOW).nextStep).toBe('resolve_observations');
    expect(assess(eligibleFacts(), 'blocked', NOW).nextStep).toBe('blocked');
    expect(assess(eligibleFacts(), 'rejected', NOW).nextStep).toBe('blocked');
  });

  it('con todo completo pero en revisión, el cliente espera; con todo completo y active, está habilitado', () => {
    expect(assess(eligibleFacts(), 'under_review', NOW).nextStep).toBe('awaiting_review');
    const active = assess(eligibleFacts(), 'active', NOW);
    expect(active.nextStep).toBe('complete');
    expect(active.eligible).toBe(true);
  });

  it('el porcentaje refleja las secciones completas, no una estimación del cliente', () => {
    const result = assess(
      eligibleFacts({ presentFinancialAttributeCodes: [], hasCurrentAddress: false, identityDocument: null }),
      'onboarding_in_progress',
      NOW,
    );
    expect(result.completionPercentage).toBe(50); // 3 de 6 secciones
  });
});
