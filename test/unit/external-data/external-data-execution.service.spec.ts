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
    const resilience = { run: jest.fn(async (fn: () => Promise<unknown>) => fn()) };
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
