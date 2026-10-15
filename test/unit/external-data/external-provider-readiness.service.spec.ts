import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { ExternalProviderReadinessService } from '../../../src/modules/external-data/application/external-provider-readiness.service.js';
import { ExternalProviderReportingService } from '../../../src/modules/external-data/application/external-provider-reporting.service.js';

/**
 * Aptitud de los proveedores para producción: readiness, auditoría de calidad (score y rating) y la
 * compuerta que orquesta ambas más el saneamiento de respuestas en un solo veredicto.
 */
describe('ExternalProviderReadinessService', () => {
  function buildService() {
    const repository = {
      listProviders: asyncMock(),
      listCostPolicies: asyncMock(),
      countRequests: asyncMock(),
      listRecentProviderResponses: asyncMock(),
    };
    const registry = { hasAdapter: asyncMock(), requireAdapter: asyncMock(), requireProviderAllowDisabled: asyncMock() };
    const reporting = new ExternalProviderReportingService(repository as never, repository as never, registry as never);
    const service = new ExternalProviderReadinessService(repository as never, repository as never, registry as never, reporting);
    return { service, repository, registry };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('getProviderReadiness', () => {
    it('reports UNKNOWN health with ADAPTER_NOT_REGISTERED when the registry has no adapter, without calling checkHealth', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'GHOST', defaultMode: 'mock_local', isActive: true },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(false as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(0 as never);

      const result = await service.getProviderReadiness();

      expect(result.readiness[0].health.status).toBe('UNKNOWN');
      expect(result.readiness[0].blockers).toContain('ADAPTER_MISSING');
      expect(registry.requireAdapter).not.toHaveBeenCalled();
    });

    it('adds NO_COST_POLICY to blockers when the provider has zero cost policies', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'SEGIP', defaultMode: 'mock_local', isActive: true },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(true as never);
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce({
        checkHealth: jest.fn(async (..._args: unknown[]) => ({ status: 'UP' })),
      } as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(0 as never);

      const result = await service.getProviderReadiness();

      expect(result.readiness[0].blockers).toContain('NO_COST_POLICY');
    });

    it('readyForProduction requires mode "production" AND zero blockers — mock_local mode is never production-ready', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'SEGIP', defaultMode: 'mock_local', isActive: true },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(true as never);
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce({
        checkHealth: jest.fn(async (..._args: unknown[]) => ({ status: 'UP' })),
      } as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([{ id: 'cp1' }] as never);
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(0 as never);

      const result = await service.getProviderReadiness();

      expect(result.readiness[0].readyForProduction).toBe(false);
    });

    it('readyForMock only requires an adapter and a non-disabled mode — it does not require a cost policy', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'SEGIP', defaultMode: 'mock_local', isActive: true },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(true as never);
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce({
        checkHealth: jest.fn(async (..._args: unknown[]) => ({ status: 'UP' })),
      } as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(0 as never);

      const result = await service.getProviderReadiness();

      expect(result.readiness[0].readyForMock).toBe(true);
    });
  });

  describe('auditExternalProvidersQuality — score y rating', () => {
    it('a provider with no findings scores 100 and rates "A"', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'SEGIP', providerCategory: 'IDENTITY', requiresConsent: true, defaultMode: 'mock_local' },
      ] as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([
        {
          queryType: 'IDENTITY_CHECK',
          costTier: 'LOW',
          requiresManualApproval: false,
          blockByDefault: false,
          allowedDecisionStagesJson: ['origination'],
        },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(true as never);

      const result = await service.auditExternalProvidersQuality();

      expect(result.score).toBe(100);
      expect(result.rating).toBe('A');
      expect(result.findings).toEqual([]);
    });

    it('flags CONSENT_DISABLED_FOR_SENSITIVE_PROVIDER (HIGH) when a sensitive-category provider does not require consent', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'INFOCENTER', providerCategory: 'CREDIT_BUREAU', requiresConsent: false, defaultMode: 'mock_local' },
      ] as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(true as never);

      const result = await service.auditExternalProvidersQuality();

      expect(result.findings.map((f) => f.code)).toContain('CONSENT_DISABLED_FOR_SENSITIVE_PROVIDER');
    });

    it('a HIGH-cost policy without both requiresManualApproval AND blockByDefault is a CRITICAL finding (HIGH_COST_NOT_BLOCKED)', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'INFOCENTER', providerCategory: 'CREDIT_BUREAU', requiresConsent: true, defaultMode: 'mock_local' },
      ] as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([
        {
          queryType: 'FULL_REPORT',
          costTier: 'HIGH',
          requiresManualApproval: true,
          blockByDefault: false,
          allowedDecisionStagesJson: ['origination'],
        },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(true as never);

      const result = await service.auditExternalProvidersQuality();

      expect(result.findings.map((f) => f.code)).toContain('HIGH_COST_NOT_BLOCKED');
      expect(result.score).toBe(75); // 100 - 1 CRITICAL * 25
    });

    it('score never goes below 0, no matter how many findings accumulate', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'INFOCENTER', providerCategory: 'CREDIT_BUREAU', requiresConsent: false, defaultMode: 'mock_local' },
      ] as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([
        { queryType: 'a', costTier: 'CRITICAL', requiresManualApproval: false, blockByDefault: false, allowedDecisionStagesJson: [] },
        { queryType: 'b', costTier: 'CRITICAL', requiresManualApproval: false, blockByDefault: false, allowedDecisionStagesJson: [] },
        { queryType: 'c', costTier: 'CRITICAL', requiresManualApproval: false, blockByDefault: false, allowedDecisionStagesJson: [] },
        { queryType: 'd', costTier: 'CRITICAL', requiresManualApproval: false, blockByDefault: false, allowedDecisionStagesJson: [] },
        { queryType: 'e', costTier: 'CRITICAL', requiresManualApproval: false, blockByDefault: false, allowedDecisionStagesJson: [] },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(false as never);

      const result = await service.auditExternalProvidersQuality();

      expect(result.score).toBe(0);
      expect(result.rating).toBe('D');
    });

    it('canEnableProductionProviders is false whenever any CRITICAL finding exists, regardless of overall score', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 'p1', providerCode: 'INFOCENTER', providerCategory: 'CREDIT_BUREAU', requiresConsent: true, defaultMode: 'mock_local' },
      ] as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValueOnce([
        {
          queryType: 'a',
          costTier: 'CRITICAL',
          requiresManualApproval: false,
          blockByDefault: false,
          allowedDecisionStagesJson: ['origination'],
        },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValueOnce(true as never);

      const result = await service.auditExternalProvidersQuality();

      expect(result.qualityGates.canEnableProductionProviders).toBe(false);
    });

    it('canRunCostlyProvidersAutomatically and scoringProviderCouplingAllowed are always false — hardcoded architectural invariants', async () => {
      const { service, repository } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([] as never);

      const result = await service.auditExternalProvidersQuality();

      expect(result.qualityGates.canRunCostlyProvidersAutomatically).toBe(false);
      expect(result.qualityGates.scoringProviderCouplingAllowed).toBe(false);
    });
  });

  describe('getProductionGate — orquesta readiness + quality + sanitization en un solo veredicto', () => {
    it('blocks with PROVIDER_NOT_FOUND when the requested providerCode is not in the readiness list', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([] as never); // readiness
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([] as never); // quality
      (repository.listRecentProviderResponses as jest.Mock).mockResolvedValueOnce([] as never); // sanitization
      void registry;

      const result = await service.getProductionGate({ providerCode: 'GHOST_PROVIDER', strict: false });

      expect(result.blockers).toContain('PROVIDER_NOT_FOUND');
      expect(result.canPromoteProduction).toBe(false);
      expect(result.status).toBe('FAIL');
    });

    it('blocks with CRITICAL_QUALITY_FINDINGS regardless of strict mode', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock)
        .mockResolvedValueOnce([{ id: 'p1', providerCode: 'INFOCENTER', defaultMode: 'mock_local', isActive: true }] as never) // readiness
        .mockResolvedValueOnce([
          { id: 'p1', providerCode: 'INFOCENTER', providerCategory: 'CREDIT_BUREAU', requiresConsent: false, defaultMode: 'mock_local' },
        ] as never); // quality
      (registry.hasAdapter as jest.Mock).mockReturnValue(true as never);
      (registry.requireAdapter as jest.Mock).mockReturnValue({
        checkHealth: jest.fn(async (..._args: unknown[]) => ({ status: 'UP' })),
      } as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValue([] as never);
      (repository.countRequests as jest.Mock).mockResolvedValue(0 as never);
      (repository.listRecentProviderResponses as jest.Mock).mockResolvedValueOnce([] as never);

      const result = await service.getProductionGate({ providerCode: 'INFOCENTER', strict: false });

      expect(result.blockers).toContain('CRITICAL_QUALITY_FINDINGS');
      expect(result.canPromoteProduction).toBe(false);
    });

    it('strict: true also blocks on HIGH findings; strict: false does not', async () => {
      const { service, repository, registry } = buildService();
      // Consent disabled on a sensitive provider is a HIGH finding (not CRITICAL) per auditExternalProvidersQuality.
      const providerRow = {
        id: 'p1',
        providerCode: 'INFOCENTER',
        providerCategory: 'CREDIT_BUREAU',
        requiresConsent: false,
        defaultMode: 'mock_local',
        isActive: true,
      };
      (repository.listProviders as jest.Mock).mockResolvedValue([providerRow] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValue(true as never);
      (registry.requireAdapter as jest.Mock).mockReturnValue({
        checkHealth: jest.fn(async (..._args: unknown[]) => ({ status: 'UP' })),
      } as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValue([{ id: 'cp1' }] as never);
      (repository.countRequests as jest.Mock).mockResolvedValue(0 as never);
      (repository.listRecentProviderResponses as jest.Mock).mockResolvedValue([] as never);

      const strictResult = await service.getProductionGate({ providerCode: 'INFOCENTER', strict: true });
      expect(strictResult.blockers).toContain('HIGH_QUALITY_FINDINGS_STRICT_MODE');

      const lenientResult = await service.getProductionGate({ providerCode: 'INFOCENTER', strict: false });
      expect(lenientResult.blockers).not.toContain('HIGH_QUALITY_FINDINGS_STRICT_MODE');
    });

    it('blocks with SANITIZATION_AUDIT_FAILED when the sanitization audit finds unredacted secrets', async () => {
      const { service, repository, registry } = buildService();
      const providerRow = {
        id: 'p1',
        providerCode: 'INFOCENTER',
        providerCategory: 'CREDIT_BUREAU',
        requiresConsent: true,
        defaultMode: 'mock_local',
        isActive: true,
      };
      (repository.listProviders as jest.Mock).mockResolvedValue([providerRow] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValue(true as never);
      (registry.requireAdapter as jest.Mock).mockReturnValue({
        checkHealth: jest.fn(async (..._args: unknown[]) => ({ status: 'UP' })),
      } as never);
      (repository.listCostPolicies as jest.Mock).mockResolvedValue([{ id: 'cp1' }] as never);
      (repository.countRequests as jest.Mock).mockResolvedValue(0 as never);
      (repository.listRecentProviderResponses as jest.Mock).mockResolvedValueOnce([
        { id: 'resp-1', providerRequestId: 'req-1', redactedPayloadJson: { access_token: 'leaked' } },
      ] as never);

      const result = await service.getProductionGate({ providerCode: 'INFOCENTER', strict: false });

      expect(result.blockers).toContain('SANITIZATION_AUDIT_FAILED');
    });

    it('deduplicates repeated blocker codes in the final list', async () => {
      const { service, repository, registry } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listRecentProviderResponses as jest.Mock).mockResolvedValueOnce([] as never);
      void registry;

      const result = await service.getProductionGate({ strict: false });

      expect(result.blockers.length).toBe(new Set(result.blockers).size);
    });

    it('always includes the 5 required manual checks, regardless of the automated verdict', async () => {
      const { service, repository } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([] as never);
      (repository.listRecentProviderResponses as jest.Mock).mockResolvedValueOnce([] as never);

      const result = await service.getProductionGate({ strict: false });

      expect(result.requiredManualChecks).toHaveLength(5);
    });
  });

  describe('ramas de defaults y blockers', () => {
    it('readiness acumula ADAPTER_MISSING + PROVIDER_DISABLED + MODE_DISABLED + NO_COST_POLICY', async () => {
      const { service, repository, registry } = buildService();
      repository.listProviders.mockResolvedValue([
        {
          id: 1,
          providerCode: 'SEGIP',
          providerName: 'Segip',
          providerCategory: null,
          providerType: 'identity',
          defaultMode: 'disabled',
          isActive: false,
          providerStatus: 'DISABLED',
        },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValue(false as never);
      repository.listCostPolicies.mockResolvedValue([] as never);
      repository.countRequests.mockResolvedValue(0 as never);

      const result = await service.getProviderReadiness();
      const entry = result.readiness[0];

      expect(entry.blockers).toEqual(expect.arrayContaining(['ADAPTER_MISSING', 'PROVIDER_DISABLED', 'MODE_DISABLED', 'NO_COST_POLICY']));
      expect(entry.health).toMatchObject({ status: 'UNKNOWN', errorCode: 'ADAPTER_NOT_REGISTERED' });
      expect(entry.readyForMock).toBe(false);
      expect(entry.readyForProduction).toBe(false);
      expect(entry.category).toBe('identity'); // providerCategory null -> providerType
      expect(entry.status).toBe('DISABLED');
    });

    it('readiness agrega HEALTH_DOWN cuando el adapter responde DOWN, y deriva status ACTIVE sin providerStatus', async () => {
      const { service, repository, registry } = buildService();
      repository.listProviders.mockResolvedValue([
        {
          id: 1,
          providerCode: 'SEGIP',
          providerName: 'Segip',
          providerCategory: 'identity',
          defaultMode: 'mock_local',
          isActive: true,
          providerStatus: null,
        },
      ] as never);
      (registry.hasAdapter as jest.Mock).mockReturnValue(true as never);
      (registry.requireAdapter as jest.Mock).mockReturnValue({
        checkHealth: jest.fn(async (..._args: unknown[]) => ({
          providerCode: 'SEGIP',
          status: 'DOWN',
          mode: 'mock_local',
          latencyMs: 1,
          checkedAt: 'now',
        })),
      } as never);
      repository.listCostPolicies.mockResolvedValue([
        { id: 1, providerId: 1, queryType: 'q', unitCostAmount: '1', currency: 'BOB', costTier: 'LOW' },
      ] as never);
      repository.countRequests.mockResolvedValue(3 as never);

      const entry = (await service.getProviderReadiness()).readiness[0];

      expect(entry.blockers).toContain('HEALTH_DOWN');
      expect(entry.blockers).not.toContain('NO_COST_POLICY');
      expect(entry.status).toBe('ACTIVE'); // providerStatus null + isActive true
      expect(entry.readyForMock).toBe(true); // hay adapter y el modo no es disabled
      expect(entry.recentFailures).toBe(3);
      expect(entry.policies).toHaveLength(1);
    });
  });
});
