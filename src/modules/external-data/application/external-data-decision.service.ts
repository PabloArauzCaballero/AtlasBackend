import { BadRequestException, Injectable } from '@nestjs/common';
import { ExternalDataRepository } from '../external-data.repository.js';
import { envBoolean, envNumber, policyNumber, toMode } from './external-data-policy.util.js';
import {
  ExternalDataRequestResult,
  ExternalProviderCode,
  ExternalProviderMode,
  ExternalProviderStatus,
  NormalizedExternalObservation,
} from '../domain/external-provider.types.js';

/** Resultado de una evaluación de política: si se bloquea la llamada al proveedor y por qué. */
export type PolicyDecision = { blocked: boolean; status: ExternalProviderStatus; reasonCode: string };

type CostPolicy = Awaited<ReturnType<ExternalDataRepository['findCostPolicy']>>;
type IdempotentRequest = Awaited<ReturnType<ExternalDataRepository['findIdempotentProviderRequest']>>;

/**
 * Decisiones de gobierno de costo/cuota/resiliencia para llamadas a proveedores externos, extraídas
 * de `ExternalDataExecutionService` (Fase 2.2 del plan 10/10). Aquí vive **si Atlas paga o no paga**
 * por una consulta externa: política de costo, cuotas global/por-usuario, circuit breaker, cache TTL,
 * y las garantías de idempotencia (no hacer replay del resultado equivocado, no cobrar dos veces).
 *
 * Depende solo del repositorio (conteos y lecturas), no de la orquestación ni del adaptador, por lo
 * que se testea de forma aislada y directa en `external-data-decision.service.spec.ts`.
 */
@Injectable()
export class ExternalDataDecisionService {
  constructor(private readonly repository: ExternalDataRepository) {}

  /** Proyección pública de la cost policy para el preview (misma forma que antes). */
  mapCostPolicy(policy: CostPolicy) {
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

  assertIdempotencyScopeMatches(
    existing: IdempotentRequest,
    expected: {
      providerId: string;
      providerCode: string;
      customerId?: string;
      queryType: string;
      purpose: string;
      decisionStage: string;
      requestPayloadHash: string;
    },
  ): void {
    if (!existing) return;
    const mismatches: string[] = [];
    if (String(existing.providerId ?? '') !== expected.providerId) mismatches.push('providerId');
    if (String(existing.customerId ?? '') !== String(expected.customerId ?? '')) mismatches.push('customerId');
    if (String(existing.requestType ?? '') !== expected.queryType) mismatches.push('queryType');
    if (String(existing.purposeCode ?? '') !== expected.purpose) mismatches.push('purpose');
    if (String(existing.decisionStage ?? '') !== expected.decisionStage) mismatches.push('decisionStage');
    if (String(existing.requestPayloadHash ?? '') !== expected.requestPayloadHash) mismatches.push('requestPayloadHash');
    if (mismatches.length > 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
        message:
          'La idempotency key ya fue usada para una solicitud externa distinta. Usa una key nueva para evitar replay incorrecto y doble costo.',
        providerCode: expected.providerCode,
        existingRequestId: String(existing.id),
        mismatches,
      });
    }
  }

  async replayIdempotentResult(existing: IdempotentRequest, providerCode: ExternalProviderCode): Promise<ExternalDataRequestResult> {
    if (!existing) {
      return {
        requestId: null,
        providerCode,
        status: 'FAILED',
        reasonCode: 'IDEMPOTENT_REQUEST_NOT_FOUND',
        observations: [],
        features: {},
        manualReviewRequired: true,
        modeUsed: 'mock_local',
      };
    }
    const responses = await this.repository.findProviderResponsesByRequestId(String(existing.id));
    const normalized = responses[0]?.normalizedPayloadJson ?? {};
    const observations = Array.isArray(normalized.observations) ? (normalized.observations as NormalizedExternalObservation[]) : [];
    const features =
      normalized.features && typeof normalized.features === 'object' && !Array.isArray(normalized.features)
        ? (normalized.features as Record<string, unknown>)
        : {};
    return {
      requestId: String(existing.id),
      providerCode,
      status: (existing.responseStatus ?? 'PENDING') as ExternalProviderStatus,
      reasonCode: existing.responseCode ?? 'IDEMPOTENT_REPLAY',
      observations,
      features,
      manualReviewRequired:
        existing.responseStatus === 'MANUAL_APPROVAL_REQUIRED' ||
        observations.some((observation) => observation.manualReviewRequired === true),
      modeUsed: toMode(existing.modeUsed),
    };
  }

  async evaluateCircuitBreaker(input: { providerId: string; providerCode: string; mode: ExternalProviderMode }): Promise<PolicyDecision> {
    if (!envBoolean('EXTERNAL_PROVIDER_CIRCUIT_BREAKER_ENABLED', true)) {
      return { blocked: false, status: 'PENDING', reasonCode: 'CIRCUIT_BREAKER_DISABLED' };
    }
    if (input.mode === 'mock_local') return { blocked: false, status: 'PENDING', reasonCode: 'CIRCUIT_BREAKER_SKIPPED_FOR_LOCAL_MOCK' };
    if (input.mode === 'disabled') {
      return { blocked: true, status: 'PROVIDER_UNAVAILABLE', reasonCode: `${input.providerCode}_PROVIDER_DISABLED` };
    }
    const threshold = envNumber('EXTERNAL_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5);
    const windowMs = envNumber('EXTERNAL_PROVIDER_CIRCUIT_BREAKER_WINDOW_MS', 10 * 60 * 1000);
    const failures = await this.repository.countRequests({
      providerId: input.providerId,
      from: new Date(Date.now() - windowMs),
      statuses: ['FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTH_FAILED', 'RATE_LIMITED'],
    });
    if (failures >= threshold) {
      return { blocked: true, status: 'PROVIDER_UNAVAILABLE', reasonCode: `${input.providerCode}_CIRCUIT_BREAKER_OPEN` };
    }
    return { blocked: false, status: 'PENDING', reasonCode: 'CIRCUIT_BREAKER_CLOSED' };
  }

  async evaluateQuotaPolicy(input: {
    providerId: string;
    providerCode: string;
    customerId?: string;
    policy: CostPolicy;
  }): Promise<PolicyDecision> {
    const policy = input.policy;
    if (!policy) return { blocked: false, status: 'PENDING', reasonCode: 'NO_POLICY_CONFIGURED_ALLOWING_DEFAULT' };
    const countableStatuses = ['COMPLETED', 'MOCKED', 'PENDING', 'MANUAL_APPROVAL_REQUIRED'];
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Secuencial e intencional: si la cuota global ya bloquea, ni siquiera se consultan las
    // cuotas por usuario (ver test "without even checking per-user quotas") — paralelizar los 3
    // conteos gastaría queries de más en el caso común de bloqueo, que es justo el que este
    // short-circuit evita.
    if (policy.maxQueriesGlobalPerDay) {
      const globalDaily = await this.repository.countRequests({
        providerId: input.providerId,
        from: startOfDay,
        statuses: countableStatuses,
      });
      if (globalDaily >= policy.maxQueriesGlobalPerDay) {
        return { blocked: true, status: 'RATE_LIMITED', reasonCode: `${input.providerCode}_GLOBAL_DAILY_QUOTA_EXCEEDED` };
      }
    }
    if (input.customerId && policy.maxQueriesPerUserPerDay) {
      const userDaily = await this.repository.countRequests({
        providerId: input.providerId,
        customerId: input.customerId,
        from: startOfDay,
        statuses: countableStatuses,
      });
      if (userDaily >= policy.maxQueriesPerUserPerDay) {
        return { blocked: true, status: 'RATE_LIMITED', reasonCode: `${input.providerCode}_USER_DAILY_QUOTA_EXCEEDED` };
      }
    }
    if (input.customerId && policy.maxQueriesPerUserPerMonth) {
      const userMonthly = await this.repository.countRequests({
        providerId: input.providerId,
        customerId: input.customerId,
        from: startOfMonth,
        statuses: countableStatuses,
      });
      if (userMonthly >= policy.maxQueriesPerUserPerMonth) {
        return { blocked: true, status: 'RATE_LIMITED', reasonCode: `${input.providerCode}_USER_MONTHLY_QUOTA_EXCEEDED` };
      }
    }
    return { blocked: false, status: 'PENDING', reasonCode: 'POLICY_ALLOW' };
  }

  cacheTtlSeconds(policy: CostPolicy): number {
    return policyNumber(policy?.cacheTtlSeconds, envNumber('EXTERNAL_PROVIDER_CACHE_TTL_SECONDS', 0));
  }

  evaluateCostPolicy(input: {
    providerCode: string;
    policy: CostPolicy;
    decisionStage: string;
    approvedByAdminId?: string;
  }): PolicyDecision {
    const policy = input.policy;
    if (!policy) return { blocked: false, status: 'PENDING', reasonCode: 'NO_POLICY_CONFIGURED_ALLOWING_DEFAULT' };
    const allowedStages = Array.isArray(policy.allowedDecisionStagesJson) ? policy.allowedDecisionStagesJson : [];
    if (allowedStages.length > 0 && !allowedStages.includes(input.decisionStage)) {
      return {
        blocked: true,
        status: 'BLOCKED_BY_COST_POLICY',
        reasonCode: `${input.providerCode}_NOT_ALLOWED_FOR_${input.decisionStage}`,
      };
    }
    const highCost = ['HIGH', 'CRITICAL'].includes(policy.costTier);
    if (highCost && policy.blockByDefault && policy.requiresManualApproval && !input.approvedByAdminId) {
      return {
        blocked: true,
        status: input.providerCode === 'INFOCENTER' ? 'BLOCKED_BY_COST_POLICY' : 'MANUAL_APPROVAL_REQUIRED',
        reasonCode:
          input.providerCode === 'INFOCENTER'
            ? 'INFOCENTER_HIGH_COST_REQUIRES_MANUAL_APPROVAL'
            : `${input.providerCode}_HIGH_COST_REQUIRES_MANUAL_APPROVAL`,
      };
    }
    return { blocked: false, status: 'PENDING', reasonCode: 'POLICY_ALLOW' };
  }
}
