/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { ExternalProviderCatalogRepository } from '../infrastructure/external-provider-catalog.repository.js';
import { ExternalProviderRequestRepository } from '../infrastructure/external-provider-request.repository.js';
import { envNumber, percentile, round2, toProviderCode } from './external-data-policy.util.js';
import { ExternalProviderRegistryService } from './external-provider-registry.service.js';

const SENSITIVE_RESPONSE_KEYS = [
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
  'password',
  'otp',
  'otp_code',
  'secret',
  'authorization',
  'cookie',
];

/** Reportes de operación de proveedores: uso/costo, SLA, idempotencia, retención y saneamiento de respuestas. */
@Injectable()
export class ExternalProviderReportingService {
  constructor(
    private readonly catalogRepository: ExternalProviderCatalogRepository,
    private readonly requestRepository: ExternalProviderRequestRepository,
    private readonly registry: ExternalProviderRegistryService,
  ) {}

  async getProviderUsage(input: { tenantId?: string; providerCode?: string; days: number }) {
    const provider = input.providerCode ? await this.registry.requireProviderAllowDisabled(toProviderCode(input.providerCode)) : null;
    const from = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const requests = await this.requestRepository.listProviderRequests({
      tenantId: input.tenantId,
      providerId: provider ? String(provider.id) : undefined,
      from,
    });
    const summary = requests.reduce(
      (acc, request) => {
        acc.total += 1;
        const status = String(request.responseStatus ?? 'UNKNOWN');
        if (['COMPLETED', 'MOCKED', 'DATA_NOT_AVAILABLE'].includes(status)) acc.executed += 1;
        if (['BLOCKED_BY_COST_POLICY', 'CONSENT_REQUIRED', 'MANUAL_APPROVAL_REQUIRED', 'RATE_LIMITED'].includes(status)) acc.blocked += 1;
        if (status === 'CACHED') acc.cached += 1;
        acc.estimatedCost += Number(request.estimatedCostAmount ?? 0);
        acc.actualCost += Number(request.actualCostAmount ?? 0);
        return acc;
      },
      { total: 0, executed: 0, blocked: 0, cached: 0, estimatedCost: 0, actualCost: 0 },
    );
    return {
      generatedAt: new Date().toISOString(),
      days: input.days,
      providerCode: input.providerCode ? toProviderCode(input.providerCode) : 'ALL',
      summary: {
        ...summary,
        estimatedCost: round2(summary.estimatedCost),
        actualCost: round2(summary.actualCost),
      },
    };
  }

  async auditIdempotencyKeys(input: { tenantId: string; days: number; limit: number }) {
    const requests = await this.requestRepository.listIdempotencyAuditRequests({
      tenantId: input.tenantId,
      from: new Date(Date.now() - input.days * 24 * 60 * 60 * 1000),
      limit: input.limit,
    });
    const groups = new Map<string, typeof requests>();
    for (const request of requests) {
      if (!request.idempotencyKey) continue;
      const key = `${request.tenantId}:${request.idempotencyKey}`;
      const current = groups.get(key) ?? [];
      current.push(request);
      groups.set(key, current);
    }
    const findings = [];
    for (const [key, items] of groups.entries()) {
      if (items.length <= 1) continue;
      const signatures = new Set(
        items.map((item) =>
          [item.providerId, item.customerId, item.requestType, item.purposeCode, item.decisionStage, item.requestPayloadHash].join('|'),
        ),
      );
      findings.push({
        severity: signatures.size > 1 ? 'HIGH' : 'LOW',
        code: signatures.size > 1 ? 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_SCOPE' : 'IDEMPOTENCY_REPLAY_SAME_SCOPE',
        keyHash: key.split(':').slice(1).join(':'),
        occurrences: items.length,
        requestIds: items.map((item) => String(item.id)),
      });
    }
    const highFindings = findings.filter((finding) => finding.severity === 'HIGH').length;
    return {
      generatedAt: new Date().toISOString(),
      days: input.days,
      inspectedRequests: requests.length,
      findings,
      score: Math.max(0, 100 - highFindings * 30 - (findings.length - highFindings) * 5),
      qualityGate: highFindings === 0 ? 'PASS' : 'FAIL',
      controls: [
        'El backend rechaza reutilizar una idempotency key con provider, payload, cliente, propósito o etapa diferente.',
        'La migración v6 intenta crear índice único por tenant/idempotency_key si no existen duplicados históricos.',
      ],
    };
  }

  async getRetentionPreview(input: { tenantId: string; days: number; limit: number }) {
    const from = new Date(0);
    const to = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const requests = await this.requestRepository.listProviderRequests({ tenantId: input.tenantId, from, to, limit: input.limit });
    return {
      generatedAt: new Date().toISOString(),
      olderThanDays: input.days,
      candidateCount: requests.length,
      candidates: requests.map((request) => ({
        requestId: String(request.id),
        providerId: request.providerId ? String(request.providerId) : null,
        customerId: request.customerId ? String(request.customerId) : null,
        requestedAt: request.requestedAt,
        responseStatus: request.responseStatus,
        action: 'REVIEW_BEFORE_PURGE_OR_ARCHIVE',
      })),
      note: 'Preview no borra datos. La purga real debe pasar por revisión legal/compliance y política de retención vigente.',
    };
  }

  async auditResponseSanitization(input: { limit: number; tenantId?: string }) {
    const responses = await this.requestRepository.listRecentProviderResponses(input.limit, input.tenantId);
    const findings = [];
    for (const response of responses) {
      const payload = JSON.stringify(response.redactedPayloadJson ?? {}).toLowerCase();
      for (const key of SENSITIVE_RESPONSE_KEYS) {
        if (payload.includes(`"${key}"`)) {
          findings.push({
            severity: 'HIGH',
            responseId: String(response.id),
            providerRequestId: String(response.providerRequestId),
            code: 'POSSIBLE_UNREDACTED_SECRET_KEY',
            key,
          });
        }
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      inspectedResponses: responses.length,
      score: Math.max(0, 100 - findings.length * 20),
      findings,
      qualityGate: findings.length === 0 ? 'PASS' : 'FAIL',
    };
  }

  async getProviderSlaReport(input: { tenantId?: string; providerCode?: string; days: number }) {
    const provider = input.providerCode ? await this.registry.requireProviderAllowDisabled(toProviderCode(input.providerCode)) : null;
    const from = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const requests = await this.requestRepository.listProviderRequests({
      tenantId: input.tenantId,
      providerId: provider ? String(provider.id) : undefined,
      from,
    });
    const providers = await this.catalogRepository.listProviders();
    const providerById = new Map(providers.map((item) => [String(item.id), String(item.providerCode)]));
    const summary = new Map<
      string,
      {
        providerCode: string;
        total: number;
        success: number;
        failed: number;
        blocked: number;
        cached: number;
        rateLimited: number;
        authFailed: number;
        latencies: number[];
        actualCost: number;
      }
    >();
    for (const request of requests) {
      const code = providerById.get(String(request.providerId)) ?? 'UNKNOWN';
      const item = summary.get(code) ?? {
        providerCode: code,
        total: 0,
        success: 0,
        failed: 0,
        blocked: 0,
        cached: 0,
        rateLimited: 0,
        authFailed: 0,
        latencies: [],
        actualCost: 0,
      };
      item.total += 1;
      const status = String(request.responseStatus ?? 'UNKNOWN');
      if (['COMPLETED', 'MOCKED', 'DATA_NOT_AVAILABLE'].includes(status)) item.success += 1;
      if (['FAILED', 'PROVIDER_UNAVAILABLE'].includes(status)) item.failed += 1;
      if (['BLOCKED_BY_COST_POLICY', 'CONSENT_REQUIRED', 'MANUAL_APPROVAL_REQUIRED'].includes(status)) item.blocked += 1;
      if (status === 'CACHED') item.cached += 1;
      if (status === 'RATE_LIMITED') item.rateLimited += 1;
      if (status === 'PROVIDER_AUTH_FAILED') item.authFailed += 1;
      if (typeof request.latencyMs === 'number') item.latencies.push(request.latencyMs);
      item.actualCost += Number(request.actualCostAmount ?? 0);
      summary.set(code, item);
    }
    return {
      generatedAt: new Date().toISOString(),
      providerCode: input.providerCode ? toProviderCode(input.providerCode) : 'ALL',
      days: input.days,
      providers: [...summary.values()].map((item) => {
        const successRate = item.total > 0 ? round2((item.success / item.total) * 100) : 0;
        const failureRate = item.total > 0 ? round2((item.failed / item.total) * 100) : 0;
        const p95LatencyMs = percentile(item.latencies, 95);
        const warnings: string[] = [];
        if (failureRate >= envNumber('EXTERNAL_PROVIDER_SLA_FAILURE_WARN_PERCENT', 10)) warnings.push('FAILURE_RATE_HIGH');
        if ((p95LatencyMs ?? 0) >= envNumber('EXTERNAL_PROVIDER_SLA_P95_LATENCY_WARN_MS', 5000)) warnings.push('P95_LATENCY_HIGH');
        if (item.authFailed > 0) warnings.push('PROVIDER_AUTH_FAILURES_PRESENT');
        return {
          providerCode: item.providerCode,
          total: item.total,
          success: item.success,
          failed: item.failed,
          blocked: item.blocked,
          cached: item.cached,
          rateLimited: item.rateLimited,
          authFailed: item.authFailed,
          successRate,
          failureRate,
          p95LatencyMs,
          actualCost: round2(item.actualCost),
          warnings,
        };
      }),
    };
  }
}
