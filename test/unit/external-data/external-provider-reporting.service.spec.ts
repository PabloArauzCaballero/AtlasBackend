import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { ExternalProviderReportingService } from '../../../src/modules/external-data/application/external-provider-reporting.service.js';

/**
 * Reportes de operación: detección de reuso indebido de idempotency keys, vista previa de retención
 * (que nunca borra), secretos sin redactar en respuestas guardadas y SLA por proveedor.
 */
describe('ExternalProviderReportingService', () => {
  function buildService() {
    const repository = {
      listProviders: asyncMock(),
      listProviderRequests: asyncMock(),
      listIdempotencyAuditRequests: asyncMock(),
      listRecentProviderResponses: asyncMock(),
    };
    const registry = { requireProviderAllowDisabled: asyncMock() };
    const service = new ExternalProviderReportingService(repository as never, repository as never, registry as never);
    return { service, repository, registry };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
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

  describe('getRetentionPreview — nunca borra nada', () => {
    it('every candidate is labeled REVIEW_BEFORE_PURGE_OR_ARCHIVE, and the note explicitly says this is a preview, not a purge', async () => {
      const { service, repository } = buildService();
      (repository.listProviderRequests as jest.Mock).mockResolvedValueOnce([
        { id: 'r1', providerId: 'p1', customerId: 'c1', requestedAt: new Date(), responseStatus: 'COMPLETED' },
      ] as never);

      const result = await service.getRetentionPreview({ tenantId: 't1', days: 365, limit: 100 });

      expect((repository.listProviderRequests as jest.Mock).mock.calls[0][0]).toMatchObject({ tenantId: 't1' });

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
