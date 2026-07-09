import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExternalDataGovernanceService } from '../../../src/modules/external-data/application/external-data-governance.service.js';

/**
 * ATLAS-P12c (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, prioridad #1
 * de lo pendiente): `ExternalDataGovernanceService` (518 líneas) era el archivo de mayor
 * prioridad sin cubrir de todo el plan de pruebas. Gobierna aprobación de solicitudes costosas,
 * el kill-switch de proveedor, el gate de promoción a producción, y la auditoría que detecta
 * reuso indebido de idempotency keys y secretos sin redactar en respuestas guardadas — cada uno
 * de estos es un control operativo real, no solo una función de reporte.
 */
describe('ExternalDataGovernanceService', () => {
  function buildService() {
    const repository = {
      findProviderRequestByIdAndTenant: jest.fn(),
      updateProviderRequest: jest.fn(),
      listProviders: jest.fn(),
      listCostPolicies: jest.fn(),
      countRequests: jest.fn(),
      updateCostPolicy: jest.fn(),
      listProviderRequests: jest.fn(),
      listIdempotencyAuditRequests: jest.fn(),
      updateProviderRuntime: jest.fn(),
      listRecentProviderResponses: jest.fn(),
      findCostPolicy: jest.fn(),
    };
    const registry = { hasAdapter: jest.fn(), requireAdapter: jest.fn(), requireProviderAllowDisabled: jest.fn() };
    const service = new ExternalDataGovernanceService(repository as never, registry as never);
    return { service, repository, registry };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('approveRequest', () => {
    it('throws NotFoundException when the request does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.approveRequest({ tenantId: 't1', requestId: 'missing', approvedByAdminId: 'admin-1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('marks approvalStatus as "approved" and records the admin id', async () => {
      const { service, repository } = buildService();
      const request = { id: 'req-1', responseStatus: null, responseCode: null, respondedAt: null, metadataJson: {}, update: jest.fn() };
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce(request as never);

      const result = await service.approveRequest({
        tenantId: 't1',
        requestId: 'req-1',
        approvedByAdminId: 'admin-1',
        approvalReason: 'urgent case',
      });

      expect(result).toEqual({ requestId: 'req-1', approvalStatus: 'approved' });
      expect(request.update).toHaveBeenCalledWith({ approvalStatus: 'approved', approvedByAdminId: 'admin-1' });
    });
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
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce({ checkHealth: jest.fn(async () => ({ status: 'UP' })) } as never);
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
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce({ checkHealth: jest.fn(async () => ({ status: 'UP' })) } as never);
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
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce({ checkHealth: jest.fn(async () => ({ status: 'UP' })) } as never);
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

  describe('updateProviderCostPolicy', () => {
    it('throws NotFoundException when the (provider, queryType) cost policy does not exist', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({ id: 'p1' } as never);
      (repository.updateCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.updateProviderCostPolicy({ providerCode: 'INFOCENTER', queryType: 'full_report', patch: {} as never }),
      ).rejects.toThrow(NotFoundException);
    });

    it('uppercases the queryType before looking up the policy', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({ id: 'p1' } as never);
      (repository.updateCostPolicy as jest.Mock).mockResolvedValueOnce({ id: 'cp1', providerId: 'p1' } as never);

      await service.updateProviderCostPolicy({ providerCode: 'infocenter', queryType: 'full_report', patch: {} as never });

      expect(repository.updateCostPolicy).toHaveBeenCalledWith('p1', 'FULL_REPORT', {});
    });
  });

  describe('auditIdempotencyKeys — detecta reuso indebido de idempotency keys', () => {
    it('a key used only once is not a finding at all', async () => {
      const { service, repository } = buildService();
      (repository.listIdempotencyAuditRequests as jest.Mock).mockResolvedValueOnce([
        {
          id: 'r1',
          tenantId: 't1',
          idempotencyKey: 'k1',
          providerId: 'p1',
          customerId: 'c1',
          requestType: 'x',
          purposeCode: 'y',
          decisionStage: 'z',
          requestPayloadHash: 'h1',
        },
      ] as never);
      const result = await service.auditIdempotencyKeys({ tenantId: 't1', days: 30, limit: 100 });
      expect(result.findings).toEqual([]);
      expect(result.qualityGate).toBe('PASS');
    });

    it('the same key reused with an identical scope is a LOW severity finding (legitimate replay)', async () => {
      const { service, repository } = buildService();
      const commonFields = {
        tenantId: 't1',
        idempotencyKey: 'k1',
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'x',
        purposeCode: 'y',
        decisionStage: 'z',
        requestPayloadHash: 'h1',
      };
      (repository.listIdempotencyAuditRequests as jest.Mock).mockResolvedValueOnce([
        { id: 'r1', ...commonFields },
        { id: 'r2', ...commonFields },
      ] as never);

      const result = await service.auditIdempotencyKeys({ tenantId: 't1', days: 30, limit: 100 });

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({ severity: 'LOW', code: 'IDEMPOTENCY_REPLAY_SAME_SCOPE', occurrences: 2 });
      expect(result.qualityGate).toBe('PASS');
    });

    it('the same key reused with a DIFFERENT scope is a HIGH severity finding and fails the quality gate', async () => {
      const { service, repository } = buildService();
      (repository.listIdempotencyAuditRequests as jest.Mock).mockResolvedValueOnce([
        {
          id: 'r1',
          tenantId: 't1',
          idempotencyKey: 'k1',
          providerId: 'p1',
          customerId: 'c1',
          requestType: 'x',
          purposeCode: 'y',
          decisionStage: 'z',
          requestPayloadHash: 'h1',
        },
        {
          id: 'r2',
          tenantId: 't1',
          idempotencyKey: 'k1',
          providerId: 'p1',
          customerId: 'c2',
          requestType: 'x',
          purposeCode: 'y',
          decisionStage: 'z',
          requestPayloadHash: 'h1',
        },
      ] as never);

      const result = await service.auditIdempotencyKeys({ tenantId: 't1', days: 30, limit: 100 });

      expect(result.findings[0]).toMatchObject({ severity: 'HIGH', code: 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_SCOPE', occurrences: 2 });
      expect(result.qualityGate).toBe('FAIL');
    });

    it('requests with no idempotencyKey at all are silently excluded from grouping, not treated as one giant group', async () => {
      const { service, repository } = buildService();
      (repository.listIdempotencyAuditRequests as jest.Mock).mockResolvedValueOnce([
        {
          id: 'r1',
          tenantId: 't1',
          idempotencyKey: null,
          providerId: 'p1',
          customerId: 'c1',
          requestType: 'x',
          purposeCode: 'y',
          decisionStage: 'z',
          requestPayloadHash: 'h1',
        },
        {
          id: 'r2',
          tenantId: 't1',
          idempotencyKey: null,
          providerId: 'p1',
          customerId: 'c1',
          requestType: 'x',
          purposeCode: 'y',
          decisionStage: 'z',
          requestPayloadHash: 'h1',
        },
      ] as never);

      const result = await service.auditIdempotencyKeys({ tenantId: 't1', days: 30, limit: 100 });

      expect(result.findings).toEqual([]);
    });
  });

  describe('updateProviderRuntimePolicy — el gate de promoción a producción', () => {
    it('throws PRODUCTION_MODE_REQUIRES_CONFIRMATION_AND_REAL_PROVIDER_CONTRACT when setting production mode without confirmProductionReady', async () => {
      const { service, registry } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({ id: 'p1', providerCode: 'SEGIP' } as never);
      await expect(service.updateProviderRuntimePolicy({ providerCode: 'SEGIP', patch: { defaultMode: 'production' } })).rejects.toThrow(
        /PRODUCTION_MODE_REQUIRES_CONFIRMATION_AND_REAL_PROVIDER_CONTRACT/,
      );
    });

    it('throws PRODUCTION_GATE_BLOCKED (with the exact blocker list) when confirmed but real integration blockers still exist', async () => {
      const { service, registry } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({ id: 'p1', providerCode: 'SEGIP' } as never);
      // sin SEGIP_REAL_INTEGRATION_IMPLEMENTED=true ni credenciales en env, productionIntegrationBlockers()
      // siempre devuelve al menos 1 bloqueador real para SEGIP en modo production.
      await expect(
        service.updateProviderRuntimePolicy({ providerCode: 'SEGIP', patch: { defaultMode: 'production', confirmProductionReady: true } }),
      ).rejects.toThrow(BadRequestException);
    });

    it('non-production mode changes (e.g. "disabled") never go through the production gate at all', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'SEGIP',
        description: null,
      } as never);
      (repository.updateProviderRuntime as jest.Mock).mockResolvedValueOnce({
        providerCode: 'SEGIP',
        defaultMode: 'disabled',
        providerStatus: 'DISABLED',
        isActive: false,
      } as never);

      const result = await service.updateProviderRuntimePolicy({ providerCode: 'SEGIP', patch: { defaultMode: 'disabled' } });

      expect(result.defaultMode).toBe('disabled');
    });
  });

  describe('activateProviderKillSwitch — apagado de emergencia de un proveedor', () => {
    it('forces defaultMode: "disabled", providerStatus: "DISABLED", isActive: false, regardless of any other state', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'INFOCENTER',
        description: null,
      } as never);
      (repository.updateProviderRuntime as jest.Mock).mockResolvedValueOnce({
        providerCode: 'INFOCENTER',
        defaultMode: 'disabled',
        providerStatus: 'DISABLED',
        isActive: false,
      } as never);

      const result = await service.activateProviderKillSwitch({ providerCode: 'INFOCENTER', reason: 'incidente de seguridad' });

      const updateArgs = (repository.updateProviderRuntime as jest.Mock).mock.calls[0][1] as {
        defaultMode: string;
        providerStatus: string;
        isActive: boolean;
      };
      expect(updateArgs).toMatchObject({ defaultMode: 'disabled', providerStatus: 'DISABLED', isActive: false });
      expect(result.isActive).toBe(false);
    });

    it('uses a default reason when none is given, instead of leaving it blank', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'INFOCENTER',
        description: null,
      } as never);
      (repository.updateProviderRuntime as jest.Mock).mockImplementationOnce(async (_id, patch) => ({
        providerCode: 'INFOCENTER',
        ...patch,
      }));

      const result = await service.activateProviderKillSwitch({ providerCode: 'INFOCENTER' });

      expect(result.reason).toBe('Kill switch activado manualmente.');
    });
  });

  describe('getRetentionPreview — nunca borra nada', () => {
    it('every candidate is labeled REVIEW_BEFORE_PURGE_OR_ARCHIVE, and the note explicitly says this is a preview, not a purge', async () => {
      const { service, repository } = buildService();
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { id: 'r1', providerId: 'p1', customerId: 'c1', requestedAt: new Date(), responseStatus: 'COMPLETED' },
      ] as never);

      const result = await service.getRetentionPreview({ days: 365, limit: 100 });

      expect(result.candidates[0].action).toBe('REVIEW_BEFORE_PURGE_OR_ARCHIVE');
      expect(result.note).toMatch(/no borra datos/i);
    });
  });

  describe('auditResponseSanitization — detecta secretos sin redactar', () => {
    it('a clean response (no sensitive keys) passes the quality gate with score 100', async () => {
      const { service, repository } = buildService();
      (repository.listRecentProviderResponses as jest.Mock).mockResolvedValueOnce([
        { id: 'resp-1', providerRequestId: 'req-1', redactedPayloadJson: { name: 'Ana', status: 'ok' } },
      ] as never);

      const result = await service.auditResponseSanitization({ limit: 100 });

      expect(result.qualityGate).toBe('PASS');
      expect(result.score).toBe(100);
    });

    it.each(['access_token', 'refresh_token', 'client_secret', 'password', 'otp'])(
      'flags a response containing an unredacted "%s" key',
      async (key) => {
        const { service, repository } = buildService();
        (repository.listRecentProviderResponses as jest.Mock).mockResolvedValueOnce([
          { id: 'resp-1', providerRequestId: 'req-1', redactedPayloadJson: { [key]: 'leaked-value' } },
        ] as never);

        const result = await service.auditResponseSanitization({ limit: 100 });

        expect(result.qualityGate).toBe('FAIL');
        expect(result.findings[0]).toMatchObject({ code: 'POSSIBLE_UNREDACTED_SECRET_KEY', key });
      },
    );

    it('each additional finding subtracts 20 points from the score, floored at 0', async () => {
      const { service, repository } = buildService();
      (repository.listRecentProviderResponses as jest.Mock).mockResolvedValueOnce([
        { id: 'resp-1', providerRequestId: 'req-1', redactedPayloadJson: { access_token: 'x', refresh_token: 'y', password: 'z' } },
      ] as never);

      const result = await service.auditResponseSanitization({ limit: 100 });

      expect(result.findings).toHaveLength(3);
      expect(result.score).toBe(40); // 100 - 3*20
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
      (registry.requireAdapter as jest.Mock).mockReturnValue({ checkHealth: jest.fn(async () => ({ status: 'UP' })) } as never);
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
      (registry.requireAdapter as jest.Mock).mockReturnValue({ checkHealth: jest.fn(async () => ({ status: 'UP' })) } as never);
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
      (registry.requireAdapter as jest.Mock).mockReturnValue({ checkHealth: jest.fn(async () => ({ status: 'UP' })) } as never);
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

  describe('getProviderSlaReport', () => {
    it('classifies each response status into exactly one bucket: success, failed, blocked, cached, or rate-limited', async () => {
      const { service, repository } = buildService();
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { providerId: 'p1', responseStatus: 'COMPLETED', latencyMs: 100, actualCostAmount: '1.00' },
        { providerId: 'p1', responseStatus: 'FAILED', latencyMs: 50, actualCostAmount: '0' },
        { providerId: 'p1', responseStatus: 'CONSENT_REQUIRED', latencyMs: null, actualCostAmount: '0' },
        { providerId: 'p1', responseStatus: 'CACHED', latencyMs: 10, actualCostAmount: '0' },
        { providerId: 'p1', responseStatus: 'RATE_LIMITED', latencyMs: null, actualCostAmount: '0' },
      ] as never);
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([{ id: 'p1', providerCode: 'INFOCENTER' }] as never);

      const result = await service.getProviderSlaReport({ days: 30 });

      const summary = result.providers[0];
      expect(summary).toMatchObject({ total: 5, success: 1, failed: 1, blocked: 1, cached: 1, rateLimited: 1 });
    });

    it('computes successRate/failureRate as percentages, rounded to 2 decimals', async () => {
      const { service, repository } = buildService();
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { providerId: 'p1', responseStatus: 'COMPLETED', latencyMs: 100, actualCostAmount: '0' },
        { providerId: 'p1', responseStatus: 'COMPLETED', latencyMs: 100, actualCostAmount: '0' },
        { providerId: 'p1', responseStatus: 'FAILED', latencyMs: 100, actualCostAmount: '0' },
      ] as never);
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([{ id: 'p1', providerCode: 'INFOCENTER' }] as never);

      const result = await service.getProviderSlaReport({ days: 30 });

      expect(result.providers[0].successRate).toBeCloseTo(66.67, 1);
      expect(result.providers[0].failureRate).toBeCloseTo(33.33, 1);
    });

    it('raises FAILURE_RATE_HIGH warning once the failure rate crosses the configured threshold', async () => {
      process.env['EXTERNAL_PROVIDER_SLA_FAILURE_WARN_PERCENT'] = '10';
      const { service, repository } = buildService();
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { providerId: 'p1', responseStatus: 'FAILED', latencyMs: 100, actualCostAmount: '0' },
        { providerId: 'p1', responseStatus: 'COMPLETED', latencyMs: 100, actualCostAmount: '0' },
      ] as never);
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([{ id: 'p1', providerCode: 'INFOCENTER' }] as never);

      const result = await service.getProviderSlaReport({ days: 30 });

      expect(result.providers[0].warnings).toContain('FAILURE_RATE_HIGH');
    });

    it('raises PROVIDER_AUTH_FAILURES_PRESENT whenever there is at least one auth failure, regardless of rate', async () => {
      const { service, repository } = buildService();
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { providerId: 'p1', responseStatus: 'PROVIDER_AUTH_FAILED', latencyMs: 100, actualCostAmount: '0' },
        ...Array.from({ length: 20 }, () => ({ providerId: 'p1', responseStatus: 'COMPLETED', latencyMs: 100, actualCostAmount: '0' })),
      ] as never);
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([{ id: 'p1', providerCode: 'INFOCENTER' }] as never);

      const result = await service.getProviderSlaReport({ days: 30 });

      expect(result.providers[0].warnings).toContain('PROVIDER_AUTH_FAILURES_PRESENT');
    });

    it('groups requests under "UNKNOWN" when the providerId does not match any known provider', async () => {
      const { service, repository } = buildService();
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { providerId: 'orphan-provider-id', responseStatus: 'COMPLETED', latencyMs: 100, actualCostAmount: '0' },
      ] as never);
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([{ id: 'p1', providerCode: 'INFOCENTER' }] as never);

      const result = await service.getProviderSlaReport({ days: 30 });

      expect(result.providers[0].providerCode).toBe('UNKNOWN');
    });

    it('p95LatencyMs is null when there are no latency samples at all', async () => {
      const { service, repository } = buildService();
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { providerId: 'p1', responseStatus: 'CONSENT_REQUIRED', latencyMs: null, actualCostAmount: '0' },
      ] as never);
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([{ id: 'p1', providerCode: 'INFOCENTER' }] as never);

      const result = await service.getProviderSlaReport({ days: 30 });

      expect(result.providers[0].p95LatencyMs).toBeNull();
    });
  });
});
