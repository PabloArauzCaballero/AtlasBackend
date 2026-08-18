/**
 * @file Verifica la fotografía persistida que alimenta la elegibilidad crediticia.
 * @business Impide habilitar crédito con evidencia omitida, mal relacionada o consultada fuera del tenant.
 * @system Ejercita todas las consultas y las relaciones indirectas de CustomerEligibilityRepository.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CustomerEligibilityRepository } from '../../../src/modules/customers/repositories/customer-eligibility.repository.js';
import { CustomerEligibilityRiskRepository } from '../../../src/modules/customers/repositories/customer-eligibility-risk.repository.js';

function model() {
  return {
    count: jest.fn(async (..._args: unknown[]) => 0),
    findOne: jest.fn(async (..._args: unknown[]) => null),
    findAll: jest.fn(async (..._args: unknown[]) => []),
  };
}

function build() {
  const models = {
    credential: model(),
    contact: model(),
    profile: model(),
    attributeValue: model(),
    attributeDefinition: model(),
    address: model(),
    reference: model(),
    identityDocument: model(),
    identityAttempt: model(),
    evidence: model(),
    evidenceReview: model(),
    consent: model(),
    consentDocument: model(),
    issue: model(),
    reviewCase: model(),
    watchlistMatch: model(),
    riskResult: model(),
    fraudCase: model(),
    onboardingFlow: model(),
  };
  // Cumplimiento y riesgo —observaciones, listas, fraude, calificación— viven en su propio
  // repositorio: son lo que el banco encontró sobre el cliente, no lo que el cliente completó.
  const riskRepository = new CustomerEligibilityRiskRepository(
    models.issue as never,
    models.watchlistMatch as never,
    models.riskResult as never,
    models.fraudCase as never,
    models.reviewCase as never,
  );
  const repository = new CustomerEligibilityRepository(
    models.credential as never,
    models.contact as never,
    models.profile as never,
    models.attributeValue as never,
    models.attributeDefinition as never,
    models.address as never,
    models.reference as never,
    models.identityDocument as never,
    models.identityAttempt as never,
    models.evidence as never,
    models.evidenceReview as never,
    models.consent as never,
    models.consentDocument as never,
    models.onboardingFlow as never,
    riskRepository,
  );
  return { repository, riskRepository, models };
}

describe('CustomerEligibilityRepository', () => {
  it('compone en paralelo todos los hechos y resuelve relaciones indirectas', async () => {
    const { repository, models } = build();
    const profile = { id: 'profile-1' };
    const identityDocument = { id: 'identity-1' };
    const latestRisk = { id: 'risk-1' };

    models.credential.count.mockResolvedValueOnce(1);
    models.contact.count.mockResolvedValueOnce(2);
    models.profile.findOne.mockResolvedValueOnce(profile as never);
    models.attributeValue.findAll.mockResolvedValueOnce([
      { attributeDefinitionId: '101', valueNumber: '4500.0000' },
      { attributeDefinitionId: null, valueNumber: null },
    ] as never);
    models.attributeDefinition.findAll.mockResolvedValueOnce([
      { id: '101', attributeCode: 'monthly_income' },
      { id: '102', attributeCode: null },
    ] as never);
    models.address.count.mockResolvedValueOnce(1);
    models.reference.count.mockResolvedValueOnce(3);
    models.identityDocument.findOne.mockResolvedValueOnce(identityDocument as never);
    models.identityAttempt.findOne.mockResolvedValueOnce({ finalResult: 'verified' } as never);
    models.evidence.findAll.mockResolvedValueOnce([{ id: 'evidence-1' }] as never);
    models.evidenceReview.count.mockResolvedValueOnce(4);
    models.consent.findAll.mockResolvedValueOnce([{ consentDocumentId: '501' }, { consentDocumentId: null }] as never);
    models.consentDocument.findAll.mockResolvedValueOnce([{ id: '501' }, { id: '502' }] as never);
    models.issue.count.mockResolvedValueOnce(5);
    models.watchlistMatch.count.mockResolvedValueOnce(6);
    models.riskResult.findOne.mockResolvedValueOnce(latestRisk as never);
    models.fraudCase.count.mockResolvedValueOnce(7);

    await expect(repository.loadFacts('7', '10')).resolves.toEqual({
      hasCredentials: true,
      verifiedContactCount: 2,
      profile,
      presentFinancialAttributeCodes: ['monthly_income'],
      // Los valores numéricos salen de la MISMA consulta que los códigos: la completitud (C5) mira
      // los códigos y la elegibilidad por producto mira los valores.
      financialAttributeValues: { monthly_income: 4500 },
      hasCurrentAddress: true,
      referenceContactCount: 3,
      identityDocument,
      identityVerificationResult: 'verified',
      pendingEvidenceReviewCount: 4,
      grantedConsentDocumentIds: ['501'],
      requiredConsentDocumentIds: ['501', '502'],
      openObservationCount: 5,
      unclearedWatchlistMatchCount: 6,
      latestRisk,
      openFraudCaseCount: 7,
    });
    expect(models.evidenceReview.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: '7' }) }),
    );
  });

  it('devuelve hechos vacíos sin consultas encadenadas innecesarias', async () => {
    const { repository, models } = build();
    models.attributeValue.findAll.mockResolvedValueOnce([]);
    models.evidence.findAll.mockResolvedValueOnce([]);

    const result = await repository.loadFacts('7', '10');

    expect(result).toMatchObject({
      hasCredentials: false,
      presentFinancialAttributeCodes: [],
      hasCurrentAddress: false,
      identityVerificationResult: null,
      pendingEvidenceReviewCount: 0,
    });
    expect(models.attributeDefinition.findAll).not.toHaveBeenCalled();
    expect(models.evidenceReview.count).not.toHaveBeenCalled();
  });

  it('expone observaciones, incidencias y flujo vigente con límites explícitos', async () => {
    const { repository, riskRepository, models } = build();
    models.reviewCase.findAll.mockResolvedValueOnce([{ id: 'review-1' }] as never);
    models.issue.findAll.mockResolvedValueOnce([{ id: 'issue-1' }] as never);
    models.onboardingFlow.findOne.mockResolvedValueOnce({ id: 'flow-1' } as never);

    await expect(riskRepository.findOpenReviewCases('7', '10')).resolves.toEqual([{ id: 'review-1' }]);
    await expect(riskRepository.findOpenIssues('7', '10')).resolves.toEqual([{ id: 'issue-1' }]);
    await expect(repository.findLatestOnboardingFlow('7', '10')).resolves.toEqual({ id: 'flow-1' });
    expect(models.reviewCase.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    expect(models.issue.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });
});
