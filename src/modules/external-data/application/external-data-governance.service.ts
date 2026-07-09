import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExternalDataRepository } from '../external-data.repository.js';
import { ExternalProviderRegistryService } from './external-provider-registry.service.js';
import {
  envNumber,
  mockBaseUrlFor,
  percentile,
  productionIntegrationBlockers,
  providerModeFromEnv,
  round2,
  toProviderCode,
} from './external-data-policy.util.js';

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

@Injectable()
export class ExternalDataGovernanceService {
  constructor(
    private readonly repository: ExternalDataRepository,
    private readonly registry: ExternalProviderRegistryService,
  ) {}

  async approveRequest(input: { tenantId: string; requestId: string; approvedByAdminId: string | undefined; approvalReason?: string }) {
    const now = new Date();
    const request = await this.repository.findProviderRequestByIdAndTenant(input.tenantId, input.requestId);
    if (!request) throw new NotFoundException('Solicitud de provider externo no encontrada.');
    await this.repository.updateProviderRequest(request, {
      responseStatus: request.responseStatus ?? 'PENDING',
      responseCode: request.responseCode ?? 'APPROVED_FOR_MANUAL_EXECUTION',
      respondedAt: request.respondedAt ?? undefined,
      metadataJson: { ...(request.metadataJson ?? {}), approvalReason: input.approvalReason ?? null, approvedAt: now.toISOString() },
    });
    await request.update({ approvalStatus: 'approved', approvedByAdminId: input.approvedByAdminId ?? null });
    return { requestId: String(request.id), approvalStatus: 'approved' };
  }

  async getProviderReadiness() {
    const providers = await this.repository.listProviders();
    const readiness = [];
    for (const provider of providers) {
      const providerCode = String(provider.providerCode);
      const mode = providerModeFromEnv(providerCode, provider.defaultMode);
      const hasAdapter = this.registry.hasAdapter(providerCode);
      const policies = await this.repository.listCostPolicies(String(provider.id));
      const health = hasAdapter
        ? await this.registry.requireAdapter(providerCode).checkHealth(mode, mockBaseUrlFor(providerCode))
        : {
            providerCode,
            status: 'UNKNOWN' as const,
            mode,
            latencyMs: 0,
            checkedAt: new Date().toISOString(),
            errorCode: 'ADAPTER_NOT_REGISTERED',
          };
      const recentFailures = await this.repository.countRequests({
        providerId: String(provider.id),
        from: new Date(Date.now() - envNumber('EXTERNAL_PROVIDER_CIRCUIT_BREAKER_WINDOW_MS', 10 * 60 * 1000)),
        statuses: ['FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTH_FAILED', 'RATE_LIMITED'],
      });
      const blockers: string[] = [...productionIntegrationBlockers(providerCode, mode)];
      if (!hasAdapter) blockers.push('ADAPTER_MISSING');
      if (provider.isActive === false || provider.providerStatus === 'DISABLED') blockers.push('PROVIDER_DISABLED');
      if (mode === 'disabled') blockers.push('MODE_DISABLED');
      if (policies.length === 0) blockers.push('NO_COST_POLICY');
      if (health.status === 'DOWN') blockers.push('HEALTH_DOWN');
      readiness.push({
        providerCode,
        name: provider.providerName,
        category: provider.providerCategory ?? provider.providerType,
        status: provider.providerStatus ?? (provider.isActive ? 'ACTIVE' : 'DISABLED'),
        mode,
        health,
        policies: policies.map((policy) => this.mapCostPolicy(policy)),
        recentFailures,
        readyForMock: hasAdapter && mode !== 'disabled',
        readyForProduction: hasAdapter && mode === 'production' && blockers.length === 0,
        blockers,
      });
    }
    return { generatedAt: new Date().toISOString(), readiness };
  }

  async auditExternalProvidersQuality() {
    const providers = await this.repository.listProviders();
    const findings: Array<{ severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; providerCode?: string; code: string; message: string }> = [];
    for (const provider of providers) {
      const providerCode = String(provider.providerCode);
      const policies = await this.repository.listCostPolicies(String(provider.id));
      if (!this.registry.hasAdapter(providerCode)) {
        findings.push({ severity: 'HIGH', providerCode, code: 'ADAPTER_MISSING', message: 'Provider configurado sin adapter registrado.' });
      }
      if (
        provider.requiresConsent === false &&
        ['IDENTITY', 'CREDIT_BUREAU', 'TELCO', 'SOCIAL', 'MESSAGING', 'DIGITAL_TRUST'].includes(String(provider.providerCategory))
      ) {
        findings.push({
          severity: 'HIGH',
          providerCode,
          code: 'CONSENT_DISABLED_FOR_SENSITIVE_PROVIDER',
          message: 'Proveedor sensible no debería operar sin consentimiento explícito.',
        });
      }
      if (policies.length === 0) {
        const missingCostPolicySeverity = String(provider.providerCategory) === 'CREDIT_BUREAU' ? 'CRITICAL' : 'MEDIUM';
        findings.push({
          severity: missingCostPolicySeverity,
          providerCode,
          code: 'MISSING_COST_POLICY',
          message: 'Provider sin política de costo/cuotas.',
        });
      }
      for (const policy of policies) {
        const highCost = ['HIGH', 'CRITICAL'].includes(policy.costTier);
        if (highCost && (!policy.requiresManualApproval || !policy.blockByDefault)) {
          findings.push({
            severity: 'CRITICAL',
            providerCode,
            code: 'HIGH_COST_NOT_BLOCKED',
            message: `Query ${policy.queryType} es costosa y no está bloqueada/manual.`,
          });
        }
        if (!Array.isArray(policy.allowedDecisionStagesJson) || policy.allowedDecisionStagesJson.length === 0) {
          findings.push({
            severity: 'MEDIUM',
            providerCode,
            code: 'POLICY_WITHOUT_ALLOWED_STAGES',
            message: `Query ${policy.queryType} no define etapas permitidas.`,
          });
        }
      }
      const mode = providerModeFromEnv(providerCode, provider.defaultMode);
      for (const blocker of productionIntegrationBlockers(providerCode, mode)) {
        findings.push({
          severity: 'CRITICAL',
          providerCode,
          code: 'PRODUCTION_INTEGRATION_GATE_BLOCKED',
          message: `Producción bloqueada: ${blocker}.`,
        });
      }
      if (mode === 'production' && (provider.providerStatus === 'MOCK_ONLY' || provider.providerStatus === 'SANDBOX_ONLY')) {
        findings.push({
          severity: 'CRITICAL',
          providerCode,
          code: 'PRODUCTION_MODE_IN_NON_PRODUCTION_PROVIDER',
          message: 'Modo production configurado en provider marcado como MOCK/SANDBOX.',
        });
      }
    }
    const critical = findings.filter((finding) => finding.severity === 'CRITICAL').length;
    const high = findings.filter((finding) => finding.severity === 'HIGH').length;
    const medium = findings.filter((finding) => finding.severity === 'MEDIUM').length;
    const score = Math.max(0, 100 - critical * 25 - high * 12 - medium * 5);
    return {
      generatedAt: new Date().toISOString(),
      score,
      rating: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D',
      findings,
      qualityGates: {
        canEnableProductionProviders: critical === 0,
        canRunCostlyProvidersAutomatically: false,
        scoringProviderCouplingAllowed: false,
      },
    };
  }

  async getProviderCostPolicies(providerCode: string) {
    const provider = await this.registry.requireProviderAllowDisabled(toProviderCode(providerCode));
    const policies = await this.repository.listCostPolicies(String(provider.id));
    return policies.map((policy) => this.mapCostPolicy(policy));
  }

  async updateProviderCostPolicy(input: {
    providerCode: string;
    queryType: string;
    patch: Parameters<ExternalDataRepository['updateCostPolicy']>[2];
  }) {
    const provider = await this.registry.requireProviderAllowDisabled(toProviderCode(input.providerCode));
    const policy = await this.repository.updateCostPolicy(String(provider.id), input.queryType.toUpperCase(), input.patch);
    if (!policy) throw new NotFoundException('Política de costo no encontrada.');
    return this.mapCostPolicy(policy);
  }

  async getProviderUsage(input: { tenantId?: string; providerCode?: string; days: number }) {
    const provider = input.providerCode ? await this.registry.requireProviderAllowDisabled(toProviderCode(input.providerCode)) : null;
    const from = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const requests = await this.repository.listProviderRequests({
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
    const requests = await this.repository.listIdempotencyAuditRequests({
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

  async updateProviderRuntimePolicy(input: {
    providerCode: string;
    patch: { defaultMode?: string; providerStatus?: string; isActive?: boolean; confirmProductionReady?: boolean; reason?: string };
  }) {
    const provider = await this.registry.requireProviderAllowDisabled(toProviderCode(input.providerCode));
    if (input.patch.defaultMode === 'production') {
      if (input.patch.confirmProductionReady !== true) {
        throw new BadRequestException('PRODUCTION_MODE_REQUIRES_CONFIRMATION_AND_REAL_PROVIDER_CONTRACT');
      }
      const blockers = productionIntegrationBlockers(String(provider.providerCode), 'production');
      if (blockers.length > 0) {
        throw new BadRequestException({
          code: 'PRODUCTION_GATE_BLOCKED',
          message: 'No se puede activar producción porque faltan contrato, credenciales o implementación real verificable.',
          providerCode: String(provider.providerCode),
          blockers,
        });
      }
    }
    const descriptionSuffix = input.patch.reason
      ? `
Runtime change: ${input.patch.reason}`
      : '';
    const updated = await this.repository.updateProviderRuntime(String(provider.id), {
      defaultMode: input.patch.defaultMode,
      providerStatus: input.patch.providerStatus,
      isActive: input.patch.isActive,
      description: descriptionSuffix ? `${provider.description ?? ''}${descriptionSuffix}`.slice(0, 5000) : undefined,
    });
    return {
      providerCode: updated?.providerCode,
      defaultMode: updated?.defaultMode,
      providerStatus: updated?.providerStatus,
      isActive: updated?.isActive,
      reason: input.patch.reason ?? null,
    };
  }

  async activateProviderKillSwitch(input: { providerCode: string; reason?: string }) {
    return this.updateProviderRuntimePolicy({
      providerCode: input.providerCode,
      patch: {
        defaultMode: 'disabled',
        providerStatus: 'DISABLED',
        isActive: false,
        reason: input.reason ?? 'Kill switch activado manualmente.',
      },
    });
  }

  async getRetentionPreview(input: { days: number; limit: number }) {
    const from = new Date(0);
    const to = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const requests = await this.repository.listProviderRequests({ from, to, limit: input.limit });
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

  async auditResponseSanitization(input: { limit: number }) {
    const responses = await this.repository.listRecentProviderResponses(input.limit);
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

  async getProductionGate(input: { providerCode?: string; strict: boolean }) {
    const readiness = await this.getProviderReadiness();
    const quality = await this.auditExternalProvidersQuality();
    const sanitization = await this.auditResponseSanitization({ limit: envNumber('EXTERNAL_PROVIDER_PROD_GATE_SANITIZATION_SAMPLE', 100) });
    const selected = input.providerCode
      ? readiness.readiness.filter((item) => item.providerCode === toProviderCode(input.providerCode ?? ''))
      : readiness.readiness;
    const providerFindings = input.providerCode
      ? quality.findings.filter((finding) => finding.providerCode === toProviderCode(input.providerCode ?? '') || !finding.providerCode)
      : quality.findings;
    const blockers: string[] = [];
    if (selected.length === 0) blockers.push('PROVIDER_NOT_FOUND');
    if (providerFindings.some((finding) => finding.severity === 'CRITICAL')) blockers.push('CRITICAL_QUALITY_FINDINGS');
    if (input.strict && providerFindings.some((finding) => finding.severity === 'HIGH')) blockers.push('HIGH_QUALITY_FINDINGS_STRICT_MODE');
    if (sanitization.qualityGate !== 'PASS') blockers.push('SANITIZATION_AUDIT_FAILED');
    for (const item of selected) {
      if (!item.readyForMock) blockers.push(`${item.providerCode}_NOT_READY_FOR_MOCK`);
      if (item.mode === 'production' && !item.readyForProduction) blockers.push(`${item.providerCode}_PRODUCTION_NOT_READY`);
      if (item.blockers.includes('NO_COST_POLICY')) blockers.push(`${item.providerCode}_NO_COST_POLICY`);
      if (item.blockers.includes('HEALTH_DOWN')) blockers.push(`${item.providerCode}_HEALTH_DOWN`);
    }
    const canPromoteProduction = blockers.length === 0;
    return {
      generatedAt: new Date().toISOString(),
      providerCode: input.providerCode ? toProviderCode(input.providerCode) : 'ALL',
      strict: input.strict,
      status: canPromoteProduction ? 'PASS' : 'FAIL',
      canPromoteProduction,
      blockers: [...new Set(blockers)],
      qualityScore: quality.score,
      sanitizationScore: sanitization.score,
      providers: selected.map((item) => ({
        providerCode: item.providerCode,
        mode: item.mode,
        healthStatus: item.health.status,
        readyForMock: item.readyForMock,
        readyForProduction: item.readyForProduction,
        blockers: item.blockers,
      })),
      requiredManualChecks: [
        'Contrato o convenio real firmado con proveedor productivo.',
        'Credenciales guardadas fuera del repositorio.',
        'Prueba sandbox exitosa con datos no sensibles.',
        'Legal/compliance aprobó consentimiento y propósito de tratamiento.',
        'Cost policy revisada por Riesgo/Finanzas antes de habilitar producción.',
      ],
    };
  }

  async getProviderSlaReport(input: { tenantId?: string; providerCode?: string; days: number }) {
    const provider = input.providerCode ? await this.registry.requireProviderAllowDisabled(toProviderCode(input.providerCode)) : null;
    const from = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const requests = await this.repository.listProviderRequests({
      tenantId: input.tenantId,
      providerId: provider ? String(provider.id) : undefined,
      from,
    });
    const providers = await this.repository.listProviders();
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

  private mapCostPolicy(policy: Awaited<ReturnType<ExternalDataRepository['findCostPolicy']>>) {
    if (!policy) return null;
    return {
      id: String(policy.id),
      providerId: String(policy.providerId),
      queryType: policy.queryType,
      unitCostAmount: policy.unitCostAmount,
      currency: policy.currency,
      costTier: policy.costTier,
      maxQueriesPerUserPerDay: policy.maxQueriesPerUserPerDay,
      maxQueriesPerUserPerMonth: policy.maxQueriesPerUserPerMonth,
      maxQueriesGlobalPerDay: policy.maxQueriesGlobalPerDay,
      allowedDecisionStagesJson: policy.allowedDecisionStagesJson ?? [],
      requiresManualApproval: policy.requiresManualApproval,
      requiresAdminRole: policy.requiresAdminRole,
      blockByDefault: policy.blockByDefault,
      cacheTtlSeconds: policy.cacheTtlSeconds,
      featureTtlSeconds: policy.featureTtlSeconds,
      retryMaxAttempts: policy.retryMaxAttempts,
      retryBackoffSeconds: policy.retryBackoffSeconds,
      active: policy.active,
      activeFrom: policy.activeFrom,
      activeTo: policy.activeTo,
    };
  }
}
