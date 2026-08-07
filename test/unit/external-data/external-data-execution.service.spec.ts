import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ExternalDataExecutionService } from '../../../src/modules/external-data/application/external-data-execution.service.js';
import { ExternalDataDecisionService } from '../../../src/modules/external-data/application/external-data-decision.service.js';
import { sha256Hex } from '../../../src/common/utils/crypto/hash.util.js';
import { stableStringify } from '../../../src/common/utils/privacy/redaction.util.js';

/**
 * Este archivo testea la ORQUESTACIÓN de `ExternalDataExecutionService` a través de su método
 * público `executeExternalDataRequest` (ramas tempranas que no necesitan ejecutar el adapter real).
 *
 * Fase 2.2 del plan 10/10: la lógica de DECISIÓN de costo/cuota/circuit-breaker/idempotencia salió a
 * `ExternalDataDecisionService` y se testea de forma aislada en `external-data-decision.service.spec.ts`.
 * Aquí se construye un `ExternalDataDecisionService` real sobre el mismo repositorio mockeado, de modo
 * que el flujo de orquestación ejercita la decisión real (idempotencia, replay) sin duplicar mocks.
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
    const resilience = { run: jest.fn(async (fn: () => Promise<unknown>, ..._rest: unknown[]) => fn()) };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const decision = new ExternalDataDecisionService(repository as never);
    const service = new ExternalDataExecutionService(
      repository as never,
      registry as never,
      resilience as never,
      decision,
      sequelize as never,
    );
    return { service, repository, registry, resilience };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
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
        execute: jest.fn(async (..._args: unknown[]) => ({
          providerCode: 'SEGIP',
          status: 'FOUND',
          payload: {},
          latencyMs: 5,
          isMocked: true,
        })),
        normalize: jest.fn(async (..._args: unknown[]) => []),
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
        execute: jest.fn(async (..._args: unknown[]) => ({
          providerCode: 'SEGIP',
          status: 'FOUND',
          payload: {},
          latencyMs: 5,
          isMocked: true,
        })),
        normalize: jest.fn(async (..._args: unknown[]) => []),
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

  describe('ramas profundas (bloqueo por política, cache, fallo de ejecución, sin customerId, preview)', () => {
    const provider = { id: 'p1', providerCode: 'SEGIP', defaultMode: 'mock_local', requiresConsent: false };
    const body = (over: Record<string, unknown> = {}) =>
      ({
        providerCode: 'SEGIP',
        queryType: 'identity_check',
        purpose: 'origination',
        decisionStage: 'origination',
        customerId: 'c1',
        input: {},
        ...over,
      }) as never;

    it('bloqueo por cost policy (HIGH + blockByDefault + requiresManualApproval, sin admin) -> MANUAL_APPROVAL_REQUIRED sin ejecutar', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce(provider as never);
      const adapter = { execute: jest.fn(), normalize: jest.fn() };
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce(adapter as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce({
        costTier: 'HIGH',
        blockByDefault: true,
        requiresManualApproval: true,
        unitCostAmount: '5',
        currency: 'BOB',
        cacheTtlSeconds: 0,
        allowedDecisionStagesJson: [],
      } as never);
      (repository.createProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'req-b' } as never);

      const result = await service.executeExternalDataRequest({ tenantId: 't1', body: body() });
      expect(result).toMatchObject({ status: 'MANUAL_APPROVAL_REQUIRED', manualReviewRequired: true });
      expect(adapter.execute).not.toHaveBeenCalled();
    });

    it('cache hit -> devuelve CACHED (replay) sin ejecutar el adapter', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce(provider as never);
      const adapter = { execute: jest.fn(), normalize: jest.fn() };
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce(adapter as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce({
        costTier: 'LOW',
        cacheTtlSeconds: 3600,
        unitCostAmount: '1',
        currency: 'BOB',
        allowedDecisionStagesJson: [],
      } as never);
      (repository.findReusableProviderRequest as jest.Mock).mockResolvedValueOnce({
        id: 'cached-1',
        responseStatus: 'COMPLETED',
        responseCode: 'OK',
        modeUsed: 'mock_local',
      } as never);
      (repository.createProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'audit-1' } as never);
      (repository.findProviderResponsesByRequestId as jest.Mock).mockResolvedValueOnce([
        { normalizedPayloadJson: { observations: [], features: {} } },
      ] as never);

      const result = await service.executeExternalDataRequest({ tenantId: 't1', body: body() });
      expect(result).toMatchObject({ status: 'CACHED', reasonCode: 'CACHE_HIT', requestId: 'audit-1' });
      expect(adapter.execute).not.toHaveBeenCalled();
    });

    it('fallo de ejecución (el adapter lanza) -> marca el request FAILED y devuelve FAILED', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce(provider as never);
      const adapter = {
        execute: jest.fn(async (..._args: unknown[]) => {
          throw new Error('provider boom');
        }),
        normalize: jest.fn(),
      };
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce(adapter as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      (repository.createProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'req-f' } as never);
      (repository.updateProviderRequest as jest.Mock).mockResolvedValueOnce({} as never);

      const result = await service.executeExternalDataRequest({ tenantId: 't1', body: body() });
      expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'provider boom', manualReviewRequired: true });
      expect((repository.updateProviderRequest as jest.Mock).mock.calls[0][1]).toMatchObject({
        responseStatus: 'FAILED',
        responseCode: 'PROVIDER_EXECUTION_FAILED',
      });
    });

    it('éxito sin customerId no crea observaciones ni feature snapshot', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce(provider as never);
      const adapter = {
        execute: jest.fn(async (..._args: unknown[]) => ({
          providerCode: 'SEGIP',
          status: 'FOUND',
          payload: {},
          latencyMs: 5,
          isMocked: true,
        })),
        normalize: jest.fn(async (..._args: unknown[]) => []),
      };
      (registry.requireAdapter as jest.Mock).mockReturnValueOnce(adapter as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      (repository.createProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'req-ok' } as never);
      (repository.updateProviderRequest as jest.Mock).mockResolvedValueOnce({} as never);
      (repository.createProviderResponse as jest.Mock).mockResolvedValueOnce({} as never);

      const result = await service.executeExternalDataRequest({ tenantId: 't1', body: body({ customerId: undefined }) });
      expect(result.requestId).toBe('req-ok');
      expect(adapter.execute).toHaveBeenCalledTimes(1);
      expect(repository.createObservations).not.toHaveBeenCalled();
      expect(repository.createFeatureSnapshot).not.toHaveBeenCalled();
    });

    it('previewExternalDataRequest: básico (wouldExecute true, consent NOT_REQUIRED)', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce(provider as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      const res = await service.previewExternalDataRequest({ tenantId: 't1', body: body() });
      expect(res).toMatchObject({ wouldExecute: true, consent: { status: 'NOT_REQUIRED' } });
      expect(res.cache.cacheEligible).toBe(false);
    });

    it('previewExternalDataRequest: bloqueado por consentimiento cuando el provider lo exige y no hay customerId', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce({ ...provider, requiresConsent: true } as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      const res = await service.previewExternalDataRequest({ tenantId: 't1', body: body({ customerId: undefined }) });
      expect(res).toMatchObject({ wouldExecute: false, status: 'CONSENT_REQUIRED', consent: { status: 'CONSENT_REQUIRED' } });
    });

    it('previewExternalDataRequest: refleja el cache hit cuando la policy tiene TTL', async () => {
      const { service, repository, registry } = buildService();
      (registry.requireProvider as jest.Mock).mockResolvedValueOnce(provider as never);
      (repository.findCostPolicy as jest.Mock).mockResolvedValueOnce({
        costTier: 'LOW',
        cacheTtlSeconds: 3600,
        unitCostAmount: '1',
        currency: 'BOB',
        allowedDecisionStagesJson: [],
      } as never);
      (repository.findReusableProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'cached-9' } as never);
      const res = await service.previewExternalDataRequest({ tenantId: 't1', body: body() });
      expect(res.cache).toMatchObject({ cacheEligible: true, cacheHit: true, cachedRequestId: 'cached-9' });
    });
  });
});
