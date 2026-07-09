import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExternalDataEvidenceService } from '../../../src/modules/external-data/application/external-data-evidence.service.js';

/**
 * ATLAS-P12 (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, Fase 1 de
 * `external-data`): este servicio arma el paquete de datos que efectivamente ve el motor de
 * scoring. `getCustomerScoringInput` incluye `rawProviderAccessBlocked: true` /
 * `scoringMayCallProvidersDirectly: false` — es la garantía explícita de que el scoring nunca
 * llama a un proveedor externo directamente, solo lee snapshots ya guardados. Vale la pena
 * fijarla con un test tanto como cualquier regla de negocio "de verdad".
 */
describe('ExternalDataEvidenceService', () => {
  function buildService() {
    const repository = {
      listCustomerConsents: jest.fn(),
      findCustomerConsentByIdAndTenant: jest.fn(),
      revokeCustomerConsent: jest.fn(),
      findProviderRequestByIdAndTenant: jest.fn(),
      findProviderResponsesByRequestIdAndTenant: jest.fn(),
      listCustomerObservations: jest.fn(),
      listCustomerFeatureSnapshots: jest.fn(),
      listProviderRequests: jest.fn(),
      findProviderResponsesByRequestId: jest.fn(),
      findProviderById: jest.fn(),
      createFeatureSnapshot: jest.fn(),
    };
    const service = new ExternalDataEvidenceService(repository as never);
    return { service, repository };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('revokeConsent', () => {
    it('throws NotFoundException when the consent does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCustomerConsentByIdAndTenant as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.revokeConsent({ tenantId: 't1', consentId: 'missing' })).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a customerId is given and does not match the consent owner', async () => {
      const { service, repository } = buildService();
      (repository.findCustomerConsentByIdAndTenant as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', customerId: 'c1' } as never);
      await expect(service.revokeConsent({ tenantId: 't1', consentId: 'consent-1', customerId: 'someone-else' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.revokeCustomerConsent).not.toHaveBeenCalled();
    });

    it('does not check ownership at all when customerId is omitted (internal/operations use)', async () => {
      const { service, repository } = buildService();
      (repository.findCustomerConsentByIdAndTenant as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', customerId: 'c1' } as never);
      (repository.revokeCustomerConsent as jest.Mock).mockResolvedValueOnce({
        id: 'consent-1',
        customerId: 'c1',
        revokedAt: new Date(),
      } as never);

      const result = await service.revokeConsent({ tenantId: 't1', consentId: 'consent-1' });

      expect(result.revoked).toBe(true);
    });
  });

  describe('getCustomerScoringInput — la garantía de que scoring nunca llama proveedores directamente', () => {
    it('always reports rawProviderAccessBlocked: true and scoringMayCallProvidersDirectly: false', async () => {
      const { service, repository } = buildService();
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([] as never);

      const result = await service.getCustomerScoringInput({ tenantId: 't1', customerId: 'c1' });

      expect(result.qualityFlags).toMatchObject({ rawProviderAccessBlocked: true, scoringMayCallProvidersDirectly: false });
    });

    it('merges features from oldest to newest snapshot, so a newer snapshot overrides an older value for the same key', async () => {
      const { service, repository } = buildService();
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([
        { id: 's2', featuresJson: { score: 'new' }, missingFeaturesJson: {}, createdAtValue: new Date(), snapshotReason: 'r2' },
        { id: 's1', featuresJson: { score: 'old' }, missingFeaturesJson: {}, createdAtValue: new Date(), snapshotReason: 'r1' },
      ] as never);

      const result = await service.getCustomerScoringInput({ tenantId: 't1', customerId: 'c1' });

      // El repositorio devuelve más reciente primero (s2, s1); el servicio hace [...snapshots].reverse()
      // antes de mezclar, así que s1 (más viejo) se aplica primero y s2 (más nuevo) gana.
      expect(result.features.score).toBe('new');
    });

    it('flags a snapshot as stale once its age exceeds maxAgeHours (default 168h)', async () => {
      const { service, repository } = buildService();
      const veryOld = new Date(Date.now() - 200 * 60 * 60 * 1000);
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([
        { id: 's1', featuresJson: {}, missingFeaturesJson: {}, createdAtValue: veryOld, snapshotReason: 'r1' },
      ] as never);

      const result = await service.getCustomerScoringInput({ tenantId: 't1', customerId: 'c1' });

      expect(result.freshness[0].stale).toBe(true);
      expect(result.qualityFlags.hasStaleFeatures).toBe(true);
    });

    it('respects EXTERNAL_FEATURE_MAX_AGE_HOURS from the environment instead of the 168h default', async () => {
      process.env['EXTERNAL_FEATURE_MAX_AGE_HOURS'] = '1';
      const { service, repository } = buildService();
      const twoHoursOld = new Date(Date.now() - 2 * 60 * 60 * 1000);
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([
        { id: 's1', featuresJson: {}, missingFeaturesJson: {}, createdAtValue: twoHoursOld, snapshotReason: 'r1' },
      ] as never);

      const result = await service.getCustomerScoringInput({ tenantId: 't1', customerId: 'c1' });

      expect(result.maxAgeHours).toBe(1);
      expect(result.freshness[0].stale).toBe(true);
    });

    it('hasExternalFeatures is false when there are no feature snapshots at all', async () => {
      const { service, repository } = buildService();
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([] as never);
      const result = await service.getCustomerScoringInput({ tenantId: 't1', customerId: 'c1' });
      expect(result.qualityFlags.hasExternalFeatures).toBe(false);
    });
  });

  describe('getCustomerDecisionPackage — riskFlags para revisión manual', () => {
    it('flags every CORE_SCORING_FEATURES entry missing from the merged features as a risk flag', async () => {
      const { service, repository } = buildService();
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listCustomerObservations as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listCustomerConsents as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([] as never);

      const result = await service.getCustomerDecisionPackage({ tenantId: 't1', customerId: 'c1', includeRawResponses: false });

      expect(result.riskFlags.hasMissingCoreFeatures).toBe(true);
      expect(result.riskFlags.missingCoreFeatures.length).toBeGreaterThan(0);
    });

    it('counts blocked and failed requests independently, by distinct status sets', async () => {
      const { service, repository } = buildService();
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listCustomerObservations as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listCustomerConsents as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { id: 'r1', responseStatus: 'CONSENT_REQUIRED' },
        { id: 'r2', responseStatus: 'RATE_LIMITED' },
        { id: 'r3', responseStatus: 'FAILED' },
        { id: 'r4', responseStatus: 'COMPLETED' },
      ] as never);

      const result = await service.getCustomerDecisionPackage({ tenantId: 't1', customerId: 'c1', includeRawResponses: false });

      expect(result.riskFlags.blockedRequestsCount).toBe(2);
      expect(result.riskFlags.failedRequestsCount).toBe(1);
    });

    it('does NOT fetch raw provider responses when includeRawResponses is false', async () => {
      const { service, repository } = buildService();
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listCustomerObservations as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listCustomerConsents as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([{ id: 'r1', responseStatus: 'COMPLETED' }] as never);

      await service.getCustomerDecisionPackage({ tenantId: 't1', customerId: 'c1', includeRawResponses: false });

      expect(repository.findProviderResponsesByRequestId).not.toHaveBeenCalled();
    });

    it('fetches raw provider responses only when includeRawResponses is true', async () => {
      const { service, repository } = buildService();
      (repository.listCustomerFeatureSnapshots as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listCustomerObservations as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listCustomerConsents as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([{ id: 'r1', responseStatus: 'COMPLETED' }] as never);
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([] as never);

      await service.getCustomerDecisionPackage({ tenantId: 't1', customerId: 'c1', includeRawResponses: true });

      expect(repository.findProviderResponsesByRequestId).toHaveBeenCalledWith('r1');
    });
  });

  describe('rebuildFeatureSnapshotFromRequest', () => {
    it('throws NotFoundException when the request does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.rebuildFeatureSnapshotFromRequest({ tenantId: 't1', requestId: 'missing' })).rejects.toThrow(NotFoundException);
    });

    it('throws REQUEST_WITHOUT_CUSTOMER_CANNOT_REBUILD_FEATURES when the request has no customerId', async () => {
      const { service, repository } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({ id: 'req-1', customerId: null } as never);
      await expect(service.rebuildFeatureSnapshotFromRequest({ tenantId: 't1', requestId: 'req-1' })).rejects.toThrow(
        /REQUEST_WITHOUT_CUSTOMER_CANNOT_REBUILD_FEATURES/,
      );
    });

    it('throws REQUEST_HAS_NO_NORMALIZED_OBSERVATIONS_TO_REBUILD when the stored response has no observations', async () => {
      const { service, repository } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        customerId: 'c1',
        providerId: 'p1',
      } as never);
      (repository.findProviderResponsesByRequestIdAndTenant as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [] } },
      ] as never);
      await expect(service.rebuildFeatureSnapshotFromRequest({ tenantId: 't1', requestId: 'req-1' })).rejects.toThrow(BadRequestException);
    });

    it('rebuilds successfully without calling the provider — the note explicitly says so, and no adapter is injected into this service at all', async () => {
      const { service, repository } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        customerId: 'c1',
        providerId: 'p1',
      } as never);
      (repository.findProviderResponsesByRequestIdAndTenant as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [{ featureKey: 'x', valueType: 'NUMBER', valueNumber: 5, confidenceScore: 0.9 }] } },
      ] as never);
      (repository.findProviderById as jest.Mock).mockResolvedValueOnce({ providerCode: 'INFOCENTER' } as never);
      (repository.createFeatureSnapshot as jest.Mock).mockResolvedValueOnce({ id: 'snap-1' } as never);

      const result = await service.rebuildFeatureSnapshotFromRequest({ tenantId: 't1', requestId: 'req-1' });

      expect(result.rebuilt).toBe(true);
      expect(result.features.x).toBe(5);
    });
  });
});
