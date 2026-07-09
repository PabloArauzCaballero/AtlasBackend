import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ExternalDataExecutionService } from '../../../src/modules/external-data/application/external-data-execution.service.js';
import { sha256Hex } from '../../../src/common/utils/crypto/hash.util.js';
import { stableStringify } from '../../../src/common/utils/privacy/redaction.util.js';

/**
 * ATLAS-P12 (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9):
 * `ExternalDataExecutionService` (672 líneas) es el archivo más grande de los 11 módulos
 * originales del plan y gobierna llamadas reales (con costo real) a proveedores externos —
 * burós de crédito, KYC. `executeExternalDataRequest` es un método de orquestación de ~250
 * líneas con demasiadas precondiciones para testear cada rama de forma realista sin una base de
 * datos real; en cambio, este archivo testea directamente los métodos de decisión que SÍ están
 * bien aislados (`evaluateCostPolicy`, `evaluateQuotaPolicy`, `evaluateCircuitBreaker`,
 * `cacheTtlSeconds`, `assertIdempotencyScopeMatches`, `replayIdempotentResult`) — son exactamente
 * los puntos donde se decide si Atlas paga o no le paga a un proveedor externo por una consulta,
 * y son los que más importa fijar por escrito. Se accede a ellos vía `(service as unknown as ...)`
 * porque son `private` — técnica de test estándar y aceptada para lógica de decisión bien
 * aislada dentro de una clase demasiado grande para testear solo a través de su método público.
 */
describe('ExternalDataExecutionService', () => {
  function buildService() {
    const repository = {
      findCostPolicy: jest.fn(),
      findIdempotentProviderRequest: jest.fn(),
      createProviderRequest: jest.fn(),
      findCustomerConsent: jest.fn(),
      findReusableProviderRequest: jest.fn(),
      countRequests: jest.fn(),
      findProviderResponsesByRequestId: jest.fn(),
      updateProviderRequest: jest.fn(),
      createProviderResponse: jest.fn(),
      createObservations: jest.fn(),
      createFeatureSnapshot: jest.fn(),
    };
    const registry = { requireProvider: jest.fn(), requireAdapter: jest.fn() };
    const resilience = { run: jest.fn(async (fn: () => Promise<unknown>) => fn()) };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new ExternalDataExecutionService(repository as never, registry as never, resilience as never, sequelize as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = service as any;
    return { service, priv, repository, registry, resilience };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('evaluateCostPolicy — decide si Atlas paga o bloquea antes de gastar', () => {
    it('allows the request when there is no cost policy configured (default-allow)', () => {
      const { priv } = buildService();
      const result = priv.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy: null, decisionStage: 'origination' });
      expect(result.blocked).toBe(false);
    });

    it('blocks when the decision stage is not in the policy allow-list', () => {
      const { priv } = buildService();
      const policy = { allowedDecisionStagesJson: ['origination'], costTier: 'LOW', blockByDefault: false, requiresManualApproval: false };
      const result = priv.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy, decisionStage: 'collections' });
      expect(result).toMatchObject({
        blocked: true,
        status: 'BLOCKED_BY_COST_POLICY',
        reasonCode: 'INFOCENTER_NOT_ALLOWED_FOR_collections',
      });
    });

    it('does not restrict decision stage when allowedDecisionStagesJson is empty', () => {
      const { priv } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'LOW', blockByDefault: false, requiresManualApproval: false };
      const result = priv.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy, decisionStage: 'anything' });
      expect(result.blocked).toBe(false);
    });

    it('blocks a HIGH/CRITICAL cost provider requiring manual approval when none was given — with a provider-specific reason for INFOCENTER', () => {
      const { priv } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'HIGH', blockByDefault: true, requiresManualApproval: true };
      const result = priv.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy, decisionStage: 'origination' });
      expect(result).toMatchObject({
        blocked: true,
        status: 'BLOCKED_BY_COST_POLICY',
        reasonCode: 'INFOCENTER_HIGH_COST_REQUIRES_MANUAL_APPROVAL',
      });
    });

    it('for a HIGH-cost provider OTHER than INFOCENTER, the same situation is MANUAL_APPROVAL_REQUIRED, not a hard block', () => {
      const { priv } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'CRITICAL', blockByDefault: true, requiresManualApproval: true };
      const result = priv.evaluateCostPolicy({ providerCode: 'SEGIP', policy, decisionStage: 'origination' });
      expect(result).toMatchObject({
        blocked: true,
        status: 'MANUAL_APPROVAL_REQUIRED',
        reasonCode: 'SEGIP_HIGH_COST_REQUIRES_MANUAL_APPROVAL',
      });
    });

    it('an approvedByAdminId bypasses the high-cost manual-approval block entirely', () => {
      const { priv } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'HIGH', blockByDefault: true, requiresManualApproval: true };
      const result = priv.evaluateCostPolicy({
        providerCode: 'INFOCENTER',
        policy,
        decisionStage: 'origination',
        approvedByAdminId: 'admin-1',
      });
      expect(result.blocked).toBe(false);
    });

    it('a LOW/MEDIUM cost tier is never blocked by the manual-approval rule, even with blockByDefault/requiresManualApproval set', () => {
      const { priv } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'MEDIUM', blockByDefault: true, requiresManualApproval: true };
      const result = priv.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy, decisionStage: 'origination' });
      expect(result.blocked).toBe(false);
    });
  });

  describe('evaluateQuotaPolicy — límites de consultas globales/por usuario', () => {
    it('allows by default when there is no policy configured', async () => {
      const { priv } = buildService();
      const result = await priv.evaluateQuotaPolicy({ providerId: 'p1', providerCode: 'INFOCENTER', policy: null });
      expect(result.blocked).toBe(false);
    });

    it('blocks with RATE_LIMITED when the global daily quota is reached, without even checking per-user quotas', async () => {
      const { priv, repository } = buildService();
      const policy = { maxQueriesGlobalPerDay: 100, maxQueriesPerUserPerDay: 10, maxQueriesPerUserPerMonth: 100 };
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(100 as never);
      const result = await priv.evaluateQuotaPolicy({ providerId: 'p1', providerCode: 'INFOCENTER', customerId: 'c1', policy });
      expect(result).toMatchObject({ blocked: true, status: 'RATE_LIMITED', reasonCode: 'INFOCENTER_GLOBAL_DAILY_QUOTA_EXCEEDED' });
      expect(repository.countRequests).toHaveBeenCalledTimes(1);
    });

    it('blocks with the per-user-daily reason when only that quota is exceeded', async () => {
      const { priv, repository } = buildService();
      const policy = { maxQueriesGlobalPerDay: 1000, maxQueriesPerUserPerDay: 5, maxQueriesPerUserPerMonth: 1000 };
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(10 as never).mockResolvedValueOnce(5 as never);
      const result = await priv.evaluateQuotaPolicy({ providerId: 'p1', providerCode: 'INFOCENTER', customerId: 'c1', policy });
      expect(result.reasonCode).toBe('INFOCENTER_USER_DAILY_QUOTA_EXCEEDED');
    });

    it('does not check per-user quotas at all when no customerId is given', async () => {
      const { priv, repository } = buildService();
      const policy = { maxQueriesGlobalPerDay: 1000, maxQueriesPerUserPerDay: 1, maxQueriesPerUserPerMonth: 1 };
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(0 as never);
      const result = await priv.evaluateQuotaPolicy({ providerId: 'p1', providerCode: 'INFOCENTER', policy });
      expect(result.blocked).toBe(false);
      expect(repository.countRequests).toHaveBeenCalledTimes(1);
    });
  });

  describe('evaluateCircuitBreaker — no seguir llamando a un proveedor que ya está fallando', () => {
    it('is entirely disabled when EXTERNAL_PROVIDER_CIRCUIT_BREAKER_ENABLED=false', async () => {
      process.env['EXTERNAL_PROVIDER_CIRCUIT_BREAKER_ENABLED'] = 'false';
      const { priv, repository } = buildService();
      const result = await priv.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'production' });
      expect(result.blocked).toBe(false);
      expect(repository.countRequests).not.toHaveBeenCalled();
    });

    it('is skipped for mock_local mode, regardless of failure count', async () => {
      const { priv, repository } = buildService();
      const result = await priv.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'mock_local' });
      expect(result.blocked).toBe(false);
      expect(repository.countRequests).not.toHaveBeenCalled();
    });

    it('blocks immediately for "disabled" mode, without counting failures', async () => {
      const { priv, repository } = buildService();
      const result = await priv.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'disabled' });
      expect(result).toMatchObject({ blocked: true, reasonCode: 'INFOCENTER_PROVIDER_DISABLED' });
      expect(repository.countRequests).not.toHaveBeenCalled();
    });

    it('opens the breaker once recent failures reach the threshold', async () => {
      const { priv, repository } = buildService();
      process.env['EXTERNAL_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD'] = '3';
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(3 as never);
      const result = await priv.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'production' });
      expect(result).toMatchObject({ blocked: true, reasonCode: 'INFOCENTER_CIRCUIT_BREAKER_OPEN' });
    });

    it('stays closed just below the threshold', async () => {
      const { priv, repository } = buildService();
      process.env['EXTERNAL_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD'] = '3';
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(2 as never);
      const result = await priv.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'production' });
      expect(result.blocked).toBe(false);
    });
  });

  describe('cacheTtlSeconds', () => {
    it('uses the policy TTL when present', () => {
      const { priv } = buildService();
      expect(priv.cacheTtlSeconds({ cacheTtlSeconds: 3600 })).toBe(3600);
    });

    it('falls back to the env default when the policy has no TTL', () => {
      process.env['EXTERNAL_PROVIDER_CACHE_TTL_SECONDS'] = '120';
      const { priv } = buildService();
      expect(priv.cacheTtlSeconds(null)).toBe(120);
    });
  });

  describe('assertIdempotencyScopeMatches — evita replay incorrecto y doble costo', () => {
    const expected = {
      providerId: 'p1',
      providerCode: 'INFOCENTER',
      customerId: 'c1',
      queryType: 'credit_check',
      purpose: 'origination',
      decisionStage: 'origination',
      requestPayloadHash: 'hash-1',
    };

    it('does nothing (no throw) when every field matches exactly', () => {
      const { priv } = buildService();
      const existing = {
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'credit_check',
        purposeCode: 'origination',
        decisionStage: 'origination',
        requestPayloadHash: 'hash-1',
        id: 'req-1',
      };
      expect(() => priv.assertIdempotencyScopeMatches(existing, expected)).not.toThrow();
    });

    it('throws BadRequestException with code IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST when the payload hash differs', () => {
      const { priv } = buildService();
      const existing = {
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'credit_check',
        purposeCode: 'origination',
        decisionStage: 'origination',
        requestPayloadHash: 'DIFFERENT-hash',
        id: 'req-1',
      };
      expect(() => priv.assertIdempotencyScopeMatches(existing, expected)).toThrow(BadRequestException);
    });

    it('lists every mismatched field, not just the first one', () => {
      const { priv } = buildService();
      const existing = {
        providerId: 'OTHER',
        customerId: 'OTHER',
        requestType: 'credit_check',
        purposeCode: 'origination',
        decisionStage: 'origination',
        requestPayloadHash: 'hash-1',
        id: 'req-1',
      };
      try {
        priv.assertIdempotencyScopeMatches(existing, expected);
        throw new Error('expected to throw');
      } catch (error) {
        const response = (error as { response?: { mismatches: string[] } }).response;
        expect(response?.mismatches).toEqual(['providerId', 'customerId']);
      }
    });

    it('does nothing when existing is null/undefined (nothing to compare against)', () => {
      const { priv } = buildService();
      expect(() => priv.assertIdempotencyScopeMatches(null, expected)).not.toThrow();
    });
  });

  describe('replayIdempotentResult', () => {
    it('returns a FAILED/manualReviewRequired result when the referenced request no longer exists', async () => {
      const { priv } = buildService();
      const result = await priv.replayIdempotentResult(null, 'INFOCENTER');
      expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'IDEMPOTENT_REQUEST_NOT_FOUND', manualReviewRequired: true });
    });

    it('replays the normalized observations/features from the stored response', async () => {
      const { priv, repository } = buildService();
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [{ featureKey: 'x', manualReviewRequired: false }], features: { x: 1 } } },
      ] as never);
      const existing = { id: 'req-1', responseStatus: 'COMPLETED', responseCode: 'OK', modeUsed: 'production' };
      const result = await priv.replayIdempotentResult(existing, 'INFOCENTER');
      expect(result.observations).toHaveLength(1);
      expect(result.features).toEqual({ x: 1 });
      expect(result.manualReviewRequired).toBe(false);
    });

    it('flags manualReviewRequired when the original response status was MANUAL_APPROVAL_REQUIRED, even if no observation flags it', async () => {
      const { priv, repository } = buildService();
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [], features: {} } },
      ] as never);
      const existing = { id: 'req-1', responseStatus: 'MANUAL_APPROVAL_REQUIRED', responseCode: 'PENDING', modeUsed: 'production' };
      const result = await priv.replayIdempotentResult(existing, 'INFOCENTER');
      expect(result.manualReviewRequired).toBe(true);
    });

    it('flags manualReviewRequired when at least one replayed observation flags it, even if the request status did not', async () => {
      const { priv, repository } = buildService();
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [{ featureKey: 'x', manualReviewRequired: true }], features: {} } },
      ] as never);
      const existing = { id: 'req-1', responseStatus: 'COMPLETED', responseCode: 'OK', modeUsed: 'production' };
      const result = await priv.replayIdempotentResult(existing, 'INFOCENTER');
      expect(result.manualReviewRequired).toBe(true);
    });
  });

  describe('executeExternalDataRequest — ramas tempranas (sin necesitar ejecutar el adapter real)', () => {
    it('replays the idempotent result and never re-executes when idempotencyKey matches a prior identical request', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'INFOCENTER',
        defaultMode: 'mock_local',
        requiresConsent: false,
      } as never);
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce({ execute: jest.fn() } as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      const requestPayloadHash = sha256Hex(stableStringify({}));
      const existing = {
        id: 'req-existing',
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'credit_check',
        purposeCode: 'origination',
        decisionStage: 'origination',
        requestPayloadHash,
        responseStatus: 'COMPLETED',
        responseCode: 'OK',
        modeUsed: 'mock_local',
      };
      (repository.findIdempotentProviderRequest as jest.Mock).mockImplementationOnce(async () => existing);
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [], features: {} } },
      ] as never);

      const result = await service.executeExternalDataRequest({
        tenantId: 't1',
        body: {
          providerCode: 'INFOCENTER',
          queryType: 'credit_check',
          purpose: 'origination',
          decisionStage: 'origination',
          customerId: 'c1',
          input: {},
        } as never,
        idempotencyKey: 'idem-1',
      });

      expect(result.requestId).toBe('req-existing');
      expect(repository.createProviderRequest).not.toHaveBeenCalled();
    });

    it('throws when the idempotencyKey matches a prior request with a DIFFERENT payload — never silently replays the wrong result', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'INFOCENTER',
        defaultMode: 'mock_local',
        requiresConsent: false,
      } as never);
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce({ execute: jest.fn() } as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      (repository.findIdempotentProviderRequest as jest.Mock).mockResolvedValueOnce({
        id: 'req-existing',
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'credit_check',
        purposeCode: 'DIFFERENT_PURPOSE',
        decisionStage: 'origination',
        requestPayloadHash: 'some-other-hash',
      } as never);

      await expect(
        service.executeExternalDataRequest({
          tenantId: 't1',
          body: {
            providerCode: 'INFOCENTER',
            queryType: 'credit_check',
            purpose: 'origination',
            decisionStage: 'origination',
            customerId: 'c1',
            input: {},
          } as never,
          idempotencyKey: 'idem-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('short-circuits with CONSENT_REQUIRED (and never calls the adapter) when the provider requires consent and none exists', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'INFOCENTER',
        defaultMode: 'mock_local',
        requiresConsent: true,
      } as never);
      const adapter = { execute: jest.fn() };
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce(adapter as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      (repository.findCustomerConsent as jest.Mock).mockResolvedValueOnce(null as never);
      (repository.createProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'req-1' } as never);

      const result = await service.executeExternalDataRequest({
        tenantId: 't1',
        body: {
          providerCode: 'INFOCENTER',
          queryType: 'credit_check',
          purpose: 'origination',
          decisionStage: 'origination',
          customerId: 'c1',
          input: {},
        } as never,
      });

      expect(result.status).toBe('CONSENT_REQUIRED');
      expect(adapter.execute).not.toHaveBeenCalled();
    });
  });

  describe('ATLAS-ROBUSTEZ: retryMaxAttempts/retryBackoffSeconds de la cost policy alimentan el kernel de resiliencia', () => {
    it('passes the policy retry settings through to ResilientAdapterExecutorService.run when executing the adapter', async () => {
      const { service, repository, registry, resilience } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'SEGIP',
        defaultMode: 'mock_local',
        requiresConsent: false,
      } as never);
      const adapter = {
        execute: jest.fn(async () => ({ providerCode: 'SEGIP', status: 'FOUND', payload: {}, latencyMs: 5, isMocked: true })),
        normalize: jest.fn(async () => []),
      };
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce(adapter as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce({ retryMaxAttempts: 4, retryBackoffSeconds: 2 } as never);
      (repository.createProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'req-1' } as never);
      (repository.updateProviderRequest as jest.Mock).mockResolvedValueOnce({} as never);
      (repository.createProviderResponse as jest.Mock).mockResolvedValueOnce({} as never);

      await service.executeExternalDataRequest({
        tenantId: 't1',
        body: {
          providerCode: 'SEGIP',
          queryType: 'identity_check',
          purpose: 'origination',
          decisionStage: 'origination',
          customerId: 'c1',
          input: {},
        } as never,
      });

      expect(resilience.run).toHaveBeenCalledWith(expect.any(Function), {
        provider: 'SEGIP',
        maxAttempts: 4,
        baseDelayMs: 2000,
      });
      expect(adapter.execute).toHaveBeenCalledTimes(1);
    });

    it('defaults to 1 attempt (no retry) when no cost policy is configured — same as before this change', async () => {
      const { service, repository, registry, resilience } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'SEGIP',
        defaultMode: 'mock_local',
        requiresConsent: false,
      } as never);
      const adapter = {
        execute: jest.fn(async () => ({ providerCode: 'SEGIP', status: 'FOUND', payload: {}, latencyMs: 5, isMocked: true })),
        normalize: jest.fn(async () => []),
      };
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce(adapter as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      (repository.createProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'req-1' } as never);
      (repository.updateProviderRequest as jest.Mock).mockResolvedValueOnce({} as never);
      (repository.createProviderResponse as jest.Mock).mockResolvedValueOnce({} as never);

      await service.executeExternalDataRequest({
        tenantId: 't1',
        body: {
          providerCode: 'SEGIP',
          queryType: 'identity_check',
          purpose: 'origination',
          decisionStage: 'origination',
          customerId: 'c1',
          input: {},
        } as never,
      });

      expect(resilience.run).toHaveBeenCalledWith(expect.any(Function), { provider: 'SEGIP', maxAttempts: 1, baseDelayMs: 200 });
    });
  });
});
