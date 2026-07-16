import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ExternalDataDecisionService } from '../../../src/modules/external-data/application/external-data-decision.service.js';

/**
 * `ExternalDataDecisionService` (extraído de `ExternalDataExecutionService` en la Fase 2.2 del plan
 * 10/10) concentra las decisiones de gobierno de costo/cuota/resiliencia/idempotencia de las
 * llamadas a proveedores externos — burós de crédito, KYC. Son exactamente los puntos donde se
 * decide si Atlas paga o no le paga a un proveedor por una consulta, y los que más importa fijar por
 * escrito. Ahora son métodos públicos de un servicio pequeño y aislado (solo depende del
 * repositorio), así que se testean directamente sin acceder a miembros privados.
 */
describe('ExternalDataDecisionService', () => {
  function buildService() {
    const repository = {
      countRequests: jest.fn(),
      findProviderResponsesByRequestId: jest.fn(),
    };
    const service = new ExternalDataDecisionService(repository as never);
    return { service, repository };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('evaluateCostPolicy — decide si Atlas paga o bloquea antes de gastar', () => {
    it('allows the request when there is no cost policy configured (default-allow)', () => {
      const { service } = buildService();
      const result = service.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy: null as never, decisionStage: 'origination' });
      expect(result.blocked).toBe(false);
    });

    it('blocks when the decision stage is not in the policy allow-list', () => {
      const { service } = buildService();
      const policy = { allowedDecisionStagesJson: ['origination'], costTier: 'LOW', blockByDefault: false, requiresManualApproval: false };
      const result = service.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy: policy as never, decisionStage: 'collections' });
      expect(result).toMatchObject({
        blocked: true,
        status: 'BLOCKED_BY_COST_POLICY',
        reasonCode: 'INFOCENTER_NOT_ALLOWED_FOR_collections',
      });
    });

    it('does not restrict decision stage when allowedDecisionStagesJson is empty', () => {
      const { service } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'LOW', blockByDefault: false, requiresManualApproval: false };
      const result = service.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy: policy as never, decisionStage: 'anything' });
      expect(result.blocked).toBe(false);
    });

    it('blocks a HIGH/CRITICAL cost provider requiring manual approval when none was given — with a provider-specific reason for INFOCENTER', () => {
      const { service } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'HIGH', blockByDefault: true, requiresManualApproval: true };
      const result = service.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy: policy as never, decisionStage: 'origination' });
      expect(result).toMatchObject({
        blocked: true,
        status: 'BLOCKED_BY_COST_POLICY',
        reasonCode: 'INFOCENTER_HIGH_COST_REQUIRES_MANUAL_APPROVAL',
      });
    });

    it('for a HIGH-cost provider OTHER than INFOCENTER, the same situation is MANUAL_APPROVAL_REQUIRED, not a hard block', () => {
      const { service } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'CRITICAL', blockByDefault: true, requiresManualApproval: true };
      const result = service.evaluateCostPolicy({ providerCode: 'SEGIP', policy: policy as never, decisionStage: 'origination' });
      expect(result).toMatchObject({
        blocked: true,
        status: 'MANUAL_APPROVAL_REQUIRED',
        reasonCode: 'SEGIP_HIGH_COST_REQUIRES_MANUAL_APPROVAL',
      });
    });

    it('an approvedByAdminId bypasses the high-cost manual-approval block entirely', () => {
      const { service } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'HIGH', blockByDefault: true, requiresManualApproval: true };
      const result = service.evaluateCostPolicy({
        providerCode: 'INFOCENTER',
        policy: policy as never,
        decisionStage: 'origination',
        approvedByAdminId: 'admin-1',
      });
      expect(result.blocked).toBe(false);
    });

    it('a LOW/MEDIUM cost tier is never blocked by the manual-approval rule, even with blockByDefault/requiresManualApproval set', () => {
      const { service } = buildService();
      const policy = { allowedDecisionStagesJson: [], costTier: 'MEDIUM', blockByDefault: true, requiresManualApproval: true };
      const result = service.evaluateCostPolicy({ providerCode: 'INFOCENTER', policy: policy as never, decisionStage: 'origination' });
      expect(result.blocked).toBe(false);
    });
  });

  describe('evaluateQuotaPolicy — límites de consultas globales/por usuario', () => {
    it('allows by default when there is no policy configured', async () => {
      const { service } = buildService();
      const result = await service.evaluateQuotaPolicy({ providerId: 'p1', providerCode: 'INFOCENTER', policy: null as never });
      expect(result.blocked).toBe(false);
    });

    it('blocks with RATE_LIMITED when the global daily quota is reached, without even checking per-user quotas', async () => {
      const { service, repository } = buildService();
      const policy = { maxQueriesGlobalPerDay: 100, maxQueriesPerUserPerDay: 10, maxQueriesPerUserPerMonth: 100 };
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(100 as never);
      const result = await service.evaluateQuotaPolicy({
        providerId: 'p1',
        providerCode: 'INFOCENTER',
        customerId: 'c1',
        policy: policy as never,
      });
      expect(result).toMatchObject({ blocked: true, status: 'RATE_LIMITED', reasonCode: 'INFOCENTER_GLOBAL_DAILY_QUOTA_EXCEEDED' });
      expect(repository.countRequests).toHaveBeenCalledTimes(1);
    });

    it('blocks with the per-user-daily reason when only that quota is exceeded', async () => {
      const { service, repository } = buildService();
      const policy = { maxQueriesGlobalPerDay: 1000, maxQueriesPerUserPerDay: 5, maxQueriesPerUserPerMonth: 1000 };
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(10 as never).mockResolvedValueOnce(5 as never);
      const result = await service.evaluateQuotaPolicy({
        providerId: 'p1',
        providerCode: 'INFOCENTER',
        customerId: 'c1',
        policy: policy as never,
      });
      expect(result.reasonCode).toBe('INFOCENTER_USER_DAILY_QUOTA_EXCEEDED');
    });

    it('does not check per-user quotas at all when no customerId is given', async () => {
      const { service, repository } = buildService();
      const policy = { maxQueriesGlobalPerDay: 1000, maxQueriesPerUserPerDay: 1, maxQueriesPerUserPerMonth: 1 };
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(0 as never);
      const result = await service.evaluateQuotaPolicy({ providerId: 'p1', providerCode: 'INFOCENTER', policy: policy as never });
      expect(result.blocked).toBe(false);
      expect(repository.countRequests).toHaveBeenCalledTimes(1);
    });
  });

  describe('evaluateCircuitBreaker — no seguir llamando a un proveedor que ya está fallando', () => {
    it('is entirely disabled when EXTERNAL_PROVIDER_CIRCUIT_BREAKER_ENABLED=false', async () => {
      process.env['EXTERNAL_PROVIDER_CIRCUIT_BREAKER_ENABLED'] = 'false';
      const { service, repository } = buildService();
      const result = await service.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'production' });
      expect(result.blocked).toBe(false);
      expect(repository.countRequests).not.toHaveBeenCalled();
    });

    it('is skipped for mock_local mode, regardless of failure count', async () => {
      const { service, repository } = buildService();
      const result = await service.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'mock_local' });
      expect(result.blocked).toBe(false);
      expect(repository.countRequests).not.toHaveBeenCalled();
    });

    it('blocks immediately for "disabled" mode, without counting failures', async () => {
      const { service, repository } = buildService();
      const result = await service.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'disabled' });
      expect(result).toMatchObject({ blocked: true, reasonCode: 'INFOCENTER_PROVIDER_DISABLED' });
      expect(repository.countRequests).not.toHaveBeenCalled();
    });

    it('opens the breaker once recent failures reach the threshold', async () => {
      const { service, repository } = buildService();
      process.env['EXTERNAL_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD'] = '3';
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(3 as never);
      const result = await service.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'production' });
      expect(result).toMatchObject({ blocked: true, reasonCode: 'INFOCENTER_CIRCUIT_BREAKER_OPEN' });
    });

    it('stays closed just below the threshold', async () => {
      const { service, repository } = buildService();
      process.env['EXTERNAL_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD'] = '3';
      (repository.countRequests as jest.Mock).mockResolvedValueOnce(2 as never);
      const result = await service.evaluateCircuitBreaker({ providerId: 'p1', providerCode: 'INFOCENTER', mode: 'production' });
      expect(result.blocked).toBe(false);
    });
  });

  describe('cacheTtlSeconds', () => {
    it('uses the policy TTL when present', () => {
      const { service } = buildService();
      expect(service.cacheTtlSeconds({ cacheTtlSeconds: 3600 } as never)).toBe(3600);
    });

    it('falls back to the env default when the policy has no TTL', () => {
      process.env['EXTERNAL_PROVIDER_CACHE_TTL_SECONDS'] = '120';
      const { service } = buildService();
      expect(service.cacheTtlSeconds(null as never)).toBe(120);
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
      const { service } = buildService();
      const existing = {
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'credit_check',
        purposeCode: 'origination',
        decisionStage: 'origination',
        requestPayloadHash: 'hash-1',
        id: 'req-1',
      };
      expect(() => service.assertIdempotencyScopeMatches(existing as never, expected)).not.toThrow();
    });

    it('throws BadRequestException with code IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST when the payload hash differs', () => {
      const { service } = buildService();
      const existing = {
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'credit_check',
        purposeCode: 'origination',
        decisionStage: 'origination',
        requestPayloadHash: 'DIFFERENT-hash',
        id: 'req-1',
      };
      expect(() => service.assertIdempotencyScopeMatches(existing as never, expected)).toThrow(BadRequestException);
    });

    it('lists every mismatched field, not just the first one', () => {
      const { service } = buildService();
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
        service.assertIdempotencyScopeMatches(existing as never, expected);
        throw new Error('expected to throw');
      } catch (error) {
        const response = (error as { response?: { mismatches: string[] } }).response;
        expect(response?.mismatches).toEqual(['providerId', 'customerId']);
      }
    });

    it('does nothing when existing is null/undefined (nothing to compare against)', () => {
      const { service } = buildService();
      expect(() => service.assertIdempotencyScopeMatches(null as never, expected)).not.toThrow();
    });
  });

  describe('replayIdempotentResult', () => {
    it('returns a FAILED/manualReviewRequired result when the referenced request no longer exists', async () => {
      const { service } = buildService();
      const result = await service.replayIdempotentResult(null as never, 'INFOCENTER');
      expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'IDEMPOTENT_REQUEST_NOT_FOUND', manualReviewRequired: true });
    });

    it('replays the normalized observations/features from the stored response', async () => {
      const { service, repository } = buildService();
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [{ featureKey: 'x', manualReviewRequired: false }], features: { x: 1 } } },
      ] as never);
      const existing = { id: 'req-1', responseStatus: 'COMPLETED', responseCode: 'OK', modeUsed: 'production' };
      const result = await service.replayIdempotentResult(existing as never, 'INFOCENTER');
      expect(result.observations).toHaveLength(1);
      expect(result.features).toEqual({ x: 1 });
      expect(result.manualReviewRequired).toBe(false);
    });

    it('flags manualReviewRequired when the original response status was MANUAL_APPROVAL_REQUIRED, even if no observation flags it', async () => {
      const { service, repository } = buildService();
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [], features: {} } },
      ] as never);
      const existing = { id: 'req-1', responseStatus: 'MANUAL_APPROVAL_REQUIRED', responseCode: 'PENDING', modeUsed: 'production' };
      const result = await service.replayIdempotentResult(existing as never, 'INFOCENTER');
      expect(result.manualReviewRequired).toBe(true);
    });

    it('flags manualReviewRequired when at least one replayed observation flags it, even if the request status did not', async () => {
      const { service, repository } = buildService();
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [{ featureKey: 'x', manualReviewRequired: true }], features: {} } },
      ] as never);
      const existing = { id: 'req-1', responseStatus: 'COMPLETED', responseCode: 'OK', modeUsed: 'production' };
      const result = await service.replayIdempotentResult(existing as never, 'INFOCENTER');
      expect(result.manualReviewRequired).toBe(true);
    });
  });
});
