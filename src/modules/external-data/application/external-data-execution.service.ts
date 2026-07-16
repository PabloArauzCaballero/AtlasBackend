import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { redactSensitiveObject, stableStringify } from '../../../common/utils/privacy/redaction.util.js';
import { ExternalDataRepository } from '../external-data.repository.js';
import { ExternalDataRequestDto } from '../external-data.schemas.js';
import { ExternalDataDecisionService } from './external-data-decision.service.js';
import { ExternalProviderRegistryService } from './external-provider-registry.service.js';
import {
  consentPurposeCodes,
  featuresFromObservations,
  isConsentRequiredError,
  mockBaseUrlFor,
  productionIntegrationBlockers,
  providerModeFromEnv,
  statusFromRaw,
  toProviderCode,
} from './external-data-policy.util.js';
import { ExternalDataRequestResult, ExternalProviderExecutionInput } from '../domain/external-provider.types.js';

@Injectable()
export class ExternalDataExecutionService {
  constructor(
    private readonly repository: ExternalDataRepository,
    private readonly registry: ExternalProviderRegistryService,
    private readonly resilience: ResilientAdapterExecutorService,
    private readonly decision: ExternalDataDecisionService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async executeExternalDataRequest(input: {
    tenantId: string;
    body: ExternalDataRequestDto;
    idempotencyKey?: string;
    requestedByUserId?: string;
    retryOfRequestId?: string;
  }): Promise<ExternalDataRequestResult> {
    const providerCode = toProviderCode(input.body.providerCode);
    const provider = await this.registry.requireProvider(providerCode);
    const adapter = this.registry.requireAdapter(providerCode);
    const policy = await this.repository.findCostPolicy(String(provider.id), input.body.queryType);
    const mode = providerModeFromEnv(String(provider.providerCode), provider.defaultMode);
    const now = new Date();
    const requestPayloadHash = sha256Hex(stableStringify(input.body.input));
    if (input.idempotencyKey) {
      const existing = await this.repository.findIdempotentProviderRequest(input.tenantId, input.idempotencyKey);
      if (existing) {
        this.decision.assertIdempotencyScopeMatches(existing, {
          providerId: String(provider.id),
          providerCode,
          customerId: input.body.customerId,
          queryType: input.body.queryType,
          purpose: input.body.purpose,
          decisionStage: input.body.decisionStage,
          requestPayloadHash,
        });
        return this.decision.replayIdempotentResult(existing, providerCode);
      }
    }
    let consent: { id: string } | null = null;
    try {
      consent = await this.validateConsent({
        tenantId: input.tenantId,
        customerId: input.body.customerId,
        providerCode,
        providerRequiresConsent: provider.requiresConsent !== false,
        purpose: input.body.purpose,
      });
    } catch (error) {
      if (!isConsentRequiredError(error)) throw error;
      const request = await this.repository.createProviderRequest({
        tenantId: input.tenantId,
        providerId: String(provider.id),
        customerId: input.body.customerId,
        requestType: input.body.queryType,
        purposeCode: input.body.purpose,
        decisionStage: input.body.decisionStage,
        modeUsed: mode,
        requestPayloadHash,
        idempotencyKey: input.idempotencyKey,
        responseStatus: 'CONSENT_REQUIRED',
        responseCode: 'CONSENT_REQUIRED',
        estimatedCostAmount: policy ? String(policy.unitCostAmount) : undefined,
        currency: policy?.currency ?? undefined,
        requestedByUserId: input.requestedByUserId,
        errorMessageSafe: 'CONSENT_REQUIRED',
        metadataJson: {
          providerCode,
          scenario: input.body.scenario ?? null,
          blockedBeforeExecution: true,
          retryOfRequestId: input.retryOfRequestId ?? null,
        },
        retryOfRequestId: input.retryOfRequestId,
        now,
      });
      return {
        requestId: String(request.id),
        providerCode,
        status: 'CONSENT_REQUIRED',
        reasonCode: 'CONSENT_REQUIRED',
        observations: [],
        features: {},
        manualReviewRequired: false,
        modeUsed: mode,
      };
    }

    let policyBlock = this.decision.evaluateCostPolicy({
      providerCode,
      policy,
      decisionStage: input.body.decisionStage,
      approvedByAdminId: input.body.approvedByAdminId,
    });
    if (!policyBlock.blocked) {
      policyBlock = await this.decision.evaluateQuotaPolicy({
        providerId: String(provider.id),
        providerCode,
        customerId: input.body.customerId,
        policy,
      });
    }

    if (!policyBlock.blocked) {
      policyBlock = await this.decision.evaluateCircuitBreaker({
        providerId: String(provider.id),
        providerCode,
        mode,
      });
    }

    if (!policyBlock.blocked) {
      const productionBlockers = productionIntegrationBlockers(providerCode, mode);
      if (productionBlockers.length > 0) {
        policyBlock = {
          blocked: true,
          status: 'PROVIDER_UNAVAILABLE',
          reasonCode: `PRODUCTION_GATE_BLOCKED:${productionBlockers.join(',')}`,
        };
      }
    }

    const cacheTtlSeconds = input.body.forceRefresh ? 0 : this.decision.cacheTtlSeconds(policy);
    if (!policyBlock.blocked && cacheTtlSeconds > 0) {
      const cachedRequest = await this.repository.findReusableProviderRequest({
        tenantId: input.tenantId,
        providerId: String(provider.id),
        customerId: input.body.customerId,
        queryType: input.body.queryType,
        requestPayloadHash,
        since: new Date(Date.now() - cacheTtlSeconds * 1000),
      });
      if (cachedRequest) {
        const auditRequest = await this.repository.createProviderRequest({
          tenantId: input.tenantId,
          providerId: String(provider.id),
          customerId: input.body.customerId,
          consentId: consent?.id ? String(consent.id) : undefined,
          requestType: input.body.queryType,
          purposeCode: input.body.purpose,
          decisionStage: input.body.decisionStage,
          modeUsed: mode,
          requestPayloadHash,
          idempotencyKey: input.idempotencyKey,
          responseStatus: 'CACHED',
          responseCode: 'CACHE_HIT',
          estimatedCostAmount: policy ? String(policy.unitCostAmount) : undefined,
          actualCostAmount: '0.0000',
          currency: policy?.currency ?? undefined,
          requestedByUserId: input.requestedByUserId,
          approvedByAdminId: input.body.approvedByAdminId,
          approvalStatus: input.body.approvedByAdminId ? 'approved_inline' : undefined,
          metadataJson: {
            providerCode,
            scenario: input.body.scenario ?? null,
            cachedFromRequestId: String(cachedRequest.id),
            cacheTtlSeconds,
            retryOfRequestId: input.retryOfRequestId ?? null,
          },
          cachedFromRequestId: String(cachedRequest.id),
          retryOfRequestId: input.retryOfRequestId,
          now,
        });
        const replayed = await this.decision.replayIdempotentResult(cachedRequest, providerCode);
        return {
          ...replayed,
          requestId: String(auditRequest.id),
          status: 'CACHED',
          reasonCode: 'CACHE_HIT',
          modeUsed: mode,
        };
      }
    }

    const request = await this.repository.createProviderRequest({
      tenantId: input.tenantId,
      providerId: String(provider.id),
      customerId: input.body.customerId,
      consentId: consent?.id ? String(consent.id) : undefined,
      requestType: input.body.queryType,
      purposeCode: input.body.purpose,
      decisionStage: input.body.decisionStage,
      modeUsed: mode,
      requestPayloadHash,
      idempotencyKey: input.idempotencyKey,
      responseStatus: policyBlock.blocked ? policyBlock.status : 'PENDING',
      responseCode: policyBlock.reasonCode,
      estimatedCostAmount: policy ? String(policy.unitCostAmount) : undefined,
      currency: policy?.currency ?? undefined,
      requestedByUserId: input.requestedByUserId,
      approvedByAdminId: input.body.approvedByAdminId,
      approvalStatus: input.body.approvedByAdminId ? 'approved_inline' : undefined,
      metadataJson: { providerCode, scenario: input.body.scenario ?? null, retryOfRequestId: input.retryOfRequestId ?? null },
      retryOfRequestId: input.retryOfRequestId,
      now,
    });

    if (policyBlock.blocked) {
      return {
        requestId: String(request.id),
        providerCode,
        status: policyBlock.status,
        reasonCode: policyBlock.reasonCode,
        observations: [],
        features: {},
        manualReviewRequired: policyBlock.status === 'MANUAL_APPROVAL_REQUIRED',
        modeUsed: mode,
      };
    }

    const executionInput: ExternalProviderExecutionInput = {
      tenantId: input.tenantId,
      customerId: input.body.customerId,
      providerCode,
      queryType: input.body.queryType as ExternalProviderExecutionInput['queryType'],
      purpose: input.body.purpose,
      decisionStage: input.body.decisionStage as ExternalProviderExecutionInput['decisionStage'],
      mode,
      input: input.body.input,
      scenario: input.body.scenario as ExternalProviderExecutionInput['scenario'],
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      approvedByAdminId: input.body.approvedByAdminId,
      mockBaseUrl: mockBaseUrlFor(providerCode),
    };

    try {
      // ATLAS-ROBUSTEZ: `retryMaxAttempts`/`retryBackoffSeconds` ya existían como columnas de
      // `external_provider_cost_policies` (y se leían en `mapCostPolicy` para el preview), pero
      // nunca se aplicaban a la ejecución real del adaptador — cualquier política que los
      // configurara no tenía ningún efecto. Ahora alimentan el kernel de resiliencia compartido
      // (`ResilientAdapterExecutorService`, el mismo que usan los adapters de `notifications`):
      // un fallo transitorio del adaptador (`AdapterError.retryable`, p. ej. timeout o 5xx una
      // vez que exista una integración real) se reintenta con backoff antes de marcar el
      // request como `FAILED`. Sin política configurada, el default es 1 intento (sin retry) —
      // mismo comportamiento observable para llamadas sin política de costo configurada.
      const raw = await this.resilience.run(() => adapter.execute(executionInput), {
        provider: providerCode,
        maxAttempts: policy?.retryMaxAttempts ?? 1,
        baseDelayMs: policy?.retryBackoffSeconds ? policy.retryBackoffSeconds * 1000 : 200,
      });
      const observations = await adapter.normalize(raw, executionInput);
      const features = featuresFromObservations(observations);
      const missingFeaturesJson = observations
        .filter((observation) => observation.valueString === 'DATA_NOT_AVAILABLE')
        .reduce<Record<string, unknown>>((acc, observation) => {
          acc[observation.featureKey] = 'DATA_NOT_AVAILABLE';
          return acc;
        }, {});
      const status = statusFromRaw(raw);
      const redactedPayload = redactSensitiveObject(raw.payload) as Record<string, unknown>;
      const responseHash = sha256Hex(stableStringify(redactedPayload));
      const manualReviewRequired = observations.some((observation) => observation.manualReviewRequired === true);

      await this.sequelize.transaction(async (transaction) => {
        await this.repository.updateProviderRequest(
          request,
          {
            responseStatus: status,
            responseCode: String(raw.status),
            latencyMs: raw.latencyMs,
            respondedAt: new Date(),
            providerRequestRef: raw.providerReference,
            actualCostAmount: policy ? String(policy.unitCostAmount) : undefined,
            metadataJson: { providerCode, isMocked: raw.isMocked, scenario: input.body.scenario ?? null },
          },
          { transaction },
        );
        await this.repository.createProviderResponse(
          {
            tenantId: input.tenantId,
            providerRequestId: String(request.id),
            redactedPayloadJson: redactedPayload,
            normalizedPayloadJson: { observations, features },
            responseHash,
            providerStatusCode: raw.statusCode,
            providerReference: raw.providerReference,
            containsSensitiveData: true,
            now: new Date(),
          },
          { transaction },
        );
        if (input.body.customerId) {
          await this.repository.createObservations(
            {
              tenantId: input.tenantId,
              customerId: input.body.customerId,
              providerId: String(provider.id),
              requestId: String(request.id),
              observations,
              now: new Date(),
            },
            { transaction },
          );
          await this.repository.createFeatureSnapshot(
            {
              tenantId: input.tenantId,
              customerId: input.body.customerId,
              providerCode,
              requestId: String(request.id),
              featuresJson: features,
              missingFeaturesJson,
              integrityHash: sha256Hex(stableStringify(features)),
              now: new Date(),
            },
            { transaction },
          );
        }
      });

      return {
        requestId: String(request.id),
        providerCode,
        status,
        reasonCode: String(raw.payload.reasonCode ?? raw.status),
        observations,
        features,
        manualReviewRequired,
        modeUsed: mode,
      };
    } catch (error) {
      const safeError = error instanceof Error ? error.message : 'UNKNOWN_PROVIDER_ERROR';
      await this.repository.updateProviderRequest(request, {
        responseStatus: 'FAILED',
        responseCode: 'PROVIDER_EXECUTION_FAILED',
        respondedAt: new Date(),
        errorMessageSafe: safeError,
      });
      return {
        requestId: String(request.id),
        providerCode,
        status: 'FAILED',
        reasonCode: safeError,
        observations: [],
        features: {},
        manualReviewRequired: true,
        modeUsed: mode,
      };
    }
  }

  async previewExternalDataRequest(input: { tenantId: string; body: ExternalDataRequestDto; requestedByUserId?: string }) {
    const providerCode = toProviderCode(input.body.providerCode);
    const provider = await this.registry.requireProvider(providerCode);
    const policy = await this.repository.findCostPolicy(String(provider.id), input.body.queryType);
    const mode = providerModeFromEnv(String(provider.providerCode), provider.defaultMode);
    const consentStatus = await this.previewConsentStatus({
      tenantId: input.tenantId,
      customerId: input.body.customerId,
      providerCode,
      providerRequiresConsent: provider.requiresConsent !== false,
      purpose: input.body.purpose,
    });
    let policyBlock = this.decision.evaluateCostPolicy({
      providerCode,
      policy,
      decisionStage: input.body.decisionStage,
      approvedByAdminId: input.body.approvedByAdminId,
    });
    if (!policyBlock.blocked) {
      policyBlock = await this.decision.evaluateQuotaPolicy({
        providerId: String(provider.id),
        providerCode,
        customerId: input.body.customerId,
        policy,
      });
    }
    if (!policyBlock.blocked) {
      policyBlock = await this.decision.evaluateCircuitBreaker({ providerId: String(provider.id), providerCode, mode });
    }
    if (!policyBlock.blocked) {
      const productionBlockers = productionIntegrationBlockers(providerCode, mode);
      if (productionBlockers.length > 0) {
        policyBlock = {
          blocked: true,
          status: 'PROVIDER_UNAVAILABLE',
          reasonCode: `PRODUCTION_GATE_BLOCKED:${productionBlockers.join(',')}`,
        };
      }
    }
    const requestPayloadHash = sha256Hex(stableStringify(input.body.input));
    const cacheTtlSeconds = input.body.forceRefresh ? 0 : this.decision.cacheTtlSeconds(policy);
    const cacheHit =
      cacheTtlSeconds > 0
        ? await this.repository.findReusableProviderRequest({
            tenantId: input.tenantId,
            providerId: String(provider.id),
            customerId: input.body.customerId,
            queryType: input.body.queryType,
            requestPayloadHash,
            since: new Date(Date.now() - cacheTtlSeconds * 1000),
          })
        : null;
    const disabled = mode === 'disabled';
    const blockedByConsent = consentStatus.status === 'CONSENT_REQUIRED';
    const blocked = disabled || blockedByConsent || policyBlock.blocked;
    return {
      providerCode,
      queryType: input.body.queryType,
      purpose: input.body.purpose,
      decisionStage: input.body.decisionStage,
      modeUsed: mode,
      wouldExecute: !blocked,
      status: disabled ? 'PROVIDER_UNAVAILABLE' : blockedByConsent ? 'CONSENT_REQUIRED' : policyBlock.status,
      reasonCode: disabled ? `${providerCode}_PROVIDER_DISABLED` : blockedByConsent ? 'CONSENT_REQUIRED' : policyBlock.reasonCode,
      consent: consentStatus,
      costPolicy: this.decision.mapCostPolicy(policy),
      estimatedCostAmount: policy ? String(policy.unitCostAmount) : null,
      currency: policy?.currency ?? null,
      requestPayloadHash,
      cache: {
        cacheTtlSeconds,
        cacheEligible: cacheTtlSeconds > 0,
        cacheHit: Boolean(cacheHit),
        cachedRequestId: cacheHit ? String(cacheHit.id) : null,
        forceRefresh: input.body.forceRefresh === true,
      },
      safeInputPreview: redactSensitiveObject(input.body.input),
      note: 'Preflight contractual: no ejecuta provider ni guarda respuesta. Úsalo antes de proveedores costosos o producción.',
    };
  }

  private async validateConsent(input: {
    tenantId: string;
    customerId?: string;
    providerCode: string;
    providerRequiresConsent: boolean;
    purpose: string;
  }) {
    if (!input.providerRequiresConsent) return null;
    if (!input.customerId) throw new ForbiddenException('CONSENT_REQUIRED');
    const consent = await this.repository.findCustomerConsent(
      input.tenantId,
      input.customerId,
      consentPurposeCodes(input.providerCode, input.purpose),
    );
    if (!consent) throw new ForbiddenException('CONSENT_REQUIRED');
    return consent;
  }

  private async previewConsentStatus(input: {
    tenantId: string;
    customerId?: string;
    providerCode: string;
    providerRequiresConsent: boolean;
    purpose: string;
  }): Promise<{ status: 'NOT_REQUIRED' | 'VALID' | 'CONSENT_REQUIRED'; consentId?: string; purposeCodes: string[] }> {
    const purposeCodes = consentPurposeCodes(input.providerCode, input.purpose);
    if (!input.providerRequiresConsent) return { status: 'NOT_REQUIRED', purposeCodes };
    if (!input.customerId) return { status: 'CONSENT_REQUIRED', purposeCodes };
    const consent = await this.repository.findCustomerConsent(input.tenantId, input.customerId, purposeCodes);
    if (!consent) return { status: 'CONSENT_REQUIRED', purposeCodes };
    return { status: 'VALID', consentId: String(consent.id), purposeCodes };
  }
}
