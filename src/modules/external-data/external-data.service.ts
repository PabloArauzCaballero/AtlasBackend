import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { redactSensitiveObject, stableStringify } from '../../common/utils/privacy/redaction.util.js';
import { ExternalDataRepository } from './external-data.repository.js';
import { ExternalConsentDto, ExternalDataRequestDto } from './external-data.schemas.js';
import { ExternalProviderAdapter } from './domain/external-provider-adapter.interface.js';
import {
  ExternalDataRequestResult,
  ExternalProviderCode,
  ExternalProviderExecutionInput,
  ExternalProviderMode,
  ExternalProviderRawResult,
  ExternalProviderStatus,
  NormalizedExternalObservation,
} from './domain/external-provider.types.js';
import { SegipAdapter } from './infrastructure/adapters/segip/segip.adapter.js';
import { InfoCenterAdapter } from './infrastructure/adapters/infocenter/infocenter.adapter.js';
import { QrGenericAdapter } from './infrastructure/adapters/qr-generic/qr-generic.adapter.js';
import { BankingGenericAdapter } from './infrastructure/adapters/banking-generic/banking-generic.adapter.js';
import { TelcoGenericAdapter } from './infrastructure/adapters/telco-generic/telco-generic.adapter.js';
import { FacebookMetaAdapter } from './infrastructure/adapters/facebook-meta/facebook-meta.adapter.js';
import { WhatsappAdapter } from './infrastructure/adapters/whatsapp/whatsapp.adapter.js';
import { DigitalTrustGenericAdapter } from './infrastructure/adapters/digital-trust-generic/digital-trust-generic.adapter.js';

function toProviderCode(providerCode: string): ExternalProviderCode {
  const normalized = providerCode.trim().toUpperCase();
  return (normalized === 'CGIP' ? 'SEGIP' : normalized) as ExternalProviderCode;
}

function toMode(value: string | null | undefined): ExternalProviderMode {
  const normalized = (value ?? 'mock_local').trim().toLowerCase();
  if (['mock_local', 'mock_server', 'sandbox', 'production', 'disabled'].includes(normalized)) return normalized as ExternalProviderMode;
  return 'mock_local';
}

function envValue(key: string): string | undefined {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function providerModeFromEnv(providerCode: string, fallback: string | null | undefined): ExternalProviderMode {
  const envKey = `${providerCode}_MODE`;
  return toMode(envValue(envKey) ?? fallback);
}

function mockBaseUrlFor(providerCode: string): string | undefined {
  const explicit = envValue(`${providerCode}_MOCK_BASE_URL`);
  if (explicit) return explicit;
  const normalizedProvider = providerCode.toUpperCase();
  const base = envValue('EXTERNAL_PROVIDERS_MOCK_BASE_URL') ?? 'http://localhost:4010/mock';
  const paths: Record<string, string> = {
    SEGIP: '/segip',
    INFOCENTER: '/infocenter',
    QR_GENERIC: '/qr',
    QR_BCB_GENERIC: '/qr',
    BANKING_GENERIC: '/banking',
    TELCO_GENERIC: '/telco',
    FACEBOOK_META: '/facebook',
    WHATSAPP_GENERIC: '/whatsapp',
    DIGITAL_TRUST_GENERIC: '/digital-trust',
  };
  return `${base}${paths[normalizedProvider] ?? `/${normalizedProvider.toLowerCase()}`}`;
}

function envBoolean(key: string, defaultValue: boolean): boolean {
  const value = envValue(key);
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envNumber(key: string, defaultValue: number): number {
  const value = envValue(key);
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

const CORE_SCORING_FEATURES = [
  'identity_document_exists',
  'identity_name_match_score',
  'identity_verification_status',
  'identity_confidence_level',
  'phone_trust_score',
  'phone_fraud_risk_score',
  'whatsapp_contactability_score',
  'digital_trust_score',
] as const;

const PRODUCTION_CREDENTIAL_REQUIREMENTS: Record<string, string[]> = {
  SEGIP: ['SEGIP_BASE_URL', 'SEGIP_CLIENT_ID', 'SEGIP_CLIENT_SECRET'],
  INFOCENTER: ['INFOCENTER_BASE_URL', 'INFOCENTER_CLIENT_ID', 'INFOCENTER_CLIENT_SECRET'],
  QR_GENERIC: ['QR_GENERIC_BASE_URL'],
  QR_BCB_GENERIC: ['QR_GENERIC_BASE_URL'],
  BANKING_GENERIC: ['BANKING_GENERIC_BASE_URL'],
  TELCO_GENERIC: ['TELCO_GENERIC_BASE_URL'],
  FACEBOOK_META: ['META_FACEBOOK_APP_ID', 'META_FACEBOOK_APP_SECRET', 'META_FACEBOOK_REDIRECT_URI'],
  WHATSAPP_GENERIC: ['WHATSAPP_PROVIDER'],
  DIGITAL_TRUST_GENERIC: ['DIGITAL_TRUST_GENERIC_BASE_URL'],
};

function productionIntegrationBlockers(providerCode: string, mode: ExternalProviderMode): string[] {
  const code = toProviderCode(providerCode);
  if (mode !== 'production') return [];
  const blockers: string[] = [];
  if (!envBoolean(`${code}_REAL_INTEGRATION_IMPLEMENTED`, false)) blockers.push(`${code}_REAL_INTEGRATION_NOT_IMPLEMENTED`);
  const requiredKeys = PRODUCTION_CREDENTIAL_REQUIREMENTS[code] ?? [`${code}_BASE_URL`];
  for (const key of requiredKeys) {
    if (!envValue(key)) blockers.push(`${key}_MISSING`);
  }
  if (envBoolean(`${code}_ALLOW_MOCK_IN_PROD`, false)) blockers.push(`${code}_MOCK_ALLOWED_IN_PRODUCTION`);
  return blockers;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function policyNumber(value: number | string | null | undefined, defaultValue: number): number {
  if (value === null || value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function isConsentRequiredError(error: unknown): boolean {
  if (error instanceof ForbiddenException) return true;
  return error instanceof Error && error.message.includes('CONSENT_REQUIRED');
}

function consentPurposeCodes(providerCode: string, purpose: string): string[] {
  const normalizedProvider = providerCode.toLowerCase();
  const normalizedPurpose = purpose.toLowerCase();
  return [
    purpose,
    normalizedPurpose,
    'risk_fraud_assessment',
    'external_data',
    `external_${normalizedPurpose}`,
    `${normalizedProvider}_${normalizedPurpose}`,
  ];
}

function statusFromRaw(raw: ExternalProviderRawResult): ExternalProviderStatus {
  if (raw.statusCode === 401 || raw.statusCode === 403 || ['UNAUTHORIZED', 'FORBIDDEN'].includes(raw.status)) return 'PROVIDER_AUTH_FAILED';
  if (raw.statusCode === 429 || raw.status === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (raw.statusCode && raw.statusCode >= 500) return 'PROVIDER_UNAVAILABLE';
  if (raw.status === 'BLOCKED_BY_COST_POLICY') return 'BLOCKED_BY_COST_POLICY';
  if (raw.status === 'DATA_NOT_AVAILABLE') return 'DATA_NOT_AVAILABLE';
  if (['PROVIDER_UNAVAILABLE', 'SEGIP_TIMEOUT'].includes(raw.status)) return 'PROVIDER_UNAVAILABLE';
  if (raw.isMocked) return 'MOCKED';
  return 'COMPLETED';
}

function featuresFromObservations(observations: NormalizedExternalObservation[]): Record<string, unknown> {
  const features: Record<string, unknown> = {};
  for (const observation of observations) {
    if (observation.valueType === 'BOOLEAN') features[observation.featureKey] = observation.valueBoolean ?? null;
    if (observation.valueType === 'NUMBER') features[observation.featureKey] = observation.valueNumber ?? null;
    if (observation.valueType === 'STRING') features[observation.featureKey] = observation.valueString ?? null;
    if (observation.valueType === 'DATE') features[observation.featureKey] = observation.valueDate ?? null;
    if (observation.valueType === 'JSON') features[observation.featureKey] = observation.valueJson ?? null;
    features[`${observation.featureKey}__confidence`] = observation.confidenceScore ?? null;
  }
  return features;
}

@Injectable()
export class ExternalDataService {
  private readonly adapters: Map<string, ExternalProviderAdapter>;

  constructor(
    private readonly repository: ExternalDataRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
    segipAdapter: SegipAdapter,
    infoCenterAdapter: InfoCenterAdapter,
    qrGenericAdapter: QrGenericAdapter,
    bankingGenericAdapter: BankingGenericAdapter,
    telcoGenericAdapter: TelcoGenericAdapter,
    facebookMetaAdapter: FacebookMetaAdapter,
    whatsappAdapter: WhatsappAdapter,
    digitalTrustGenericAdapter: DigitalTrustGenericAdapter,
  ) {
    this.adapters = new Map(
      [
        segipAdapter,
        infoCenterAdapter,
        qrGenericAdapter,
        bankingGenericAdapter,
        telcoGenericAdapter,
        facebookMetaAdapter,
        whatsappAdapter,
        digitalTrustGenericAdapter,
      ].flatMap((adapter) => {
        const entries: [string, ExternalProviderAdapter][] = [[adapter.providerCode, adapter]];
        if (adapter.providerCode === 'SEGIP') entries.push(['CGIP', adapter]);
        if (adapter.providerCode === 'QR_GENERIC') entries.push(['QR_BCB_GENERIC', adapter]);
        return entries;
      }),
    );
  }

  async createConsent(input: { tenantId: string; body: ExternalConsentDto; ipAddress?: string; userAgent?: string }) {
    const providerCode = input.body.providerCode ? toProviderCode(input.body.providerCode) : 'GENERAL';
    const purposeCode =
      providerCode === 'GENERAL' ? input.body.purpose : `${providerCode.toLowerCase()}_${input.body.purpose.toLowerCase()}`;
    const consent = await this.repository.createCustomerConsent({
      tenantId: input.tenantId,
      customerId: input.body.customerId,
      purposeCode,
      channel: input.body.channel,
      sessionId: input.body.sessionId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceFingerprintSnapshot: input.body.deviceFingerprintSnapshot,
      now: new Date(),
    });
    return {
      id: String(consent.id),
      customerId: input.body.customerId,
      providerCode,
      purposeCode,
      accepted: true,
      grantedAt: consent.grantedAt,
    };
  }

  async listProviders() {
    const providers = await this.repository.listProviders();
    return providers.map((provider) => ({
      id: String(provider.id),
      code: provider.providerCode,
      name: provider.providerName,
      category: provider.providerCategory ?? provider.providerType,
      status: provider.providerStatus ?? (provider.isActive ? 'ACTIVE' : 'DISABLED'),
      defaultMode: provider.defaultMode,
      requiresConsent: provider.requiresConsent,
      requiresManualApproval: provider.requiresManualApproval,
      isCostly: provider.isCostly,
      description: provider.description,
    }));
  }

  async getProviderHealth(providerCode?: string) {
    const providers = providerCode ? [await this.requireProvider(toProviderCode(providerCode))] : await this.repository.listProviders();
    const results = [];
    for (const provider of providers) {
      if (!provider) continue;
      const code = String(provider.providerCode);
      const adapter = this.requireAdapter(code);
      const mode = providerModeFromEnv(code, provider.defaultMode);
      const health = await adapter.checkHealth(mode, mockBaseUrlFor(code));
      await this.repository.createHealthLog({ providerId: String(provider.id), health });
      results.push(health);
    }
    return providerCode ? results[0] : results;
  }

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

  async executeExternalDataRequest(input: {
    tenantId: string;
    body: ExternalDataRequestDto;
    idempotencyKey?: string;
    requestedByUserId?: string;
    retryOfRequestId?: string;
  }): Promise<ExternalDataRequestResult> {
    const providerCode = toProviderCode(input.body.providerCode);
    const provider = await this.requireProvider(providerCode);
    const adapter = this.requireAdapter(providerCode);
    const policy = await this.repository.findCostPolicy(String(provider.id), input.body.queryType);
    const mode = providerModeFromEnv(String(provider.providerCode), provider.defaultMode);
    const now = new Date();
    const requestPayloadHash = sha256Hex(stableStringify(input.body.input));
    if (input.idempotencyKey) {
      const existing = await this.repository.findIdempotentProviderRequest(input.tenantId, input.idempotencyKey);
      if (existing) {
        this.assertIdempotencyScopeMatches(existing, {
          providerId: String(provider.id),
          providerCode,
          customerId: input.body.customerId,
          queryType: input.body.queryType,
          purpose: input.body.purpose,
          decisionStage: input.body.decisionStage,
          requestPayloadHash,
        });
        return this.replayIdempotentResult(existing, providerCode);
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

    let policyBlock = this.evaluateCostPolicy({
      providerCode,
      policy,
      decisionStage: input.body.decisionStage,
      approvedByAdminId: input.body.approvedByAdminId,
    });
    if (!policyBlock.blocked) {
      policyBlock = await this.evaluateQuotaPolicy({
        providerId: String(provider.id),
        providerCode,
        customerId: input.body.customerId,
        policy,
      });
    }

    if (!policyBlock.blocked) {
      policyBlock = await this.evaluateCircuitBreaker({
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

    const cacheTtlSeconds = input.body.forceRefresh ? 0 : this.cacheTtlSeconds(policy);
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
        const replayed = await this.replayIdempotentResult(cachedRequest, providerCode);
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
      const raw = await adapter.execute(executionInput);
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
    const provider = await this.requireProvider(providerCode);
    const policy = await this.repository.findCostPolicy(String(provider.id), input.body.queryType);
    const mode = providerModeFromEnv(String(provider.providerCode), provider.defaultMode);
    const consentStatus = await this.previewConsentStatus({
      tenantId: input.tenantId,
      customerId: input.body.customerId,
      providerCode,
      providerRequiresConsent: provider.requiresConsent !== false,
      purpose: input.body.purpose,
    });
    let policyBlock = this.evaluateCostPolicy({
      providerCode,
      policy,
      decisionStage: input.body.decisionStage,
      approvedByAdminId: input.body.approvedByAdminId,
    });
    if (!policyBlock.blocked) {
      policyBlock = await this.evaluateQuotaPolicy({
        providerId: String(provider.id),
        providerCode,
        customerId: input.body.customerId,
        policy,
      });
    }
    if (!policyBlock.blocked) {
      policyBlock = await this.evaluateCircuitBreaker({ providerId: String(provider.id), providerCode, mode });
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
    const cacheTtlSeconds = input.body.forceRefresh ? 0 : this.cacheTtlSeconds(policy);
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
      costPolicy: this.mapCostPolicy(policy),
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

  async getProviderReadiness() {
    const providers = await this.repository.listProviders();
    const readiness = [];
    for (const provider of providers) {
      const providerCode = String(provider.providerCode);
      const mode = providerModeFromEnv(providerCode, provider.defaultMode);
      const adapter = this.adapters.get(providerCode);
      const policies = await this.repository.listCostPolicies(String(provider.id));
      const health = adapter
        ? await adapter.checkHealth(mode, mockBaseUrlFor(providerCode))
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
      const blockers = [] as string[];
      blockers.push(...productionIntegrationBlockers(providerCode, mode));
      if (!adapter) blockers.push('ADAPTER_MISSING');
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
        readyForMock: Boolean(adapter) && mode !== 'disabled',
        readyForProduction: Boolean(adapter) && mode === 'production' && blockers.length === 0,
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
      if (!this.adapters.has(providerCode)) {
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
        findings.push({ severity: 'MEDIUM', providerCode, code: 'MISSING_COST_POLICY', message: 'Provider sin política de costo/cuotas.' });
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

  async executeSegip(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'SEGIP',
        queryType: 'IDENTITY_VERIFICATION',
        purpose: 'KYC_ONBOARDING',
        decisionStage: 'ONBOARDING',
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }

  async executeInfocenter(input: {
    tenantId: string;
    customerId: string;
    body: { documentNumber?: string; decisionStage: string; approvedByAdminId?: string; scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'INFOCENTER',
        queryType: 'CREDIT_REPORT',
        purpose: 'CREDIT_EVALUATION',
        decisionStage: input.body.decisionStage,
        input: { documentNumber: input.body.documentNumber },
        scenario: input.body.scenario,
        approvedByAdminId: input.body.approvedByAdminId,
      },
    });
  }

  async listCustomerConsents(input: { tenantId: string; customerId: string }) {
    const consents = await this.repository.listCustomerConsents(input.tenantId, input.customerId);
    return consents.map((consent) => ({
      id: String(consent.id),
      customerId: String(consent.customerId),
      purposeCode: consent.purposeCode,
      granted: consent.granted,
      grantedAt: consent.grantedAt,
      revokedAt: consent.revokedAt,
      channel: consent.channel,
    }));
  }

  async revokeConsent(input: { tenantId: string; consentId: string; customerId?: string }) {
    const existing = await this.repository.findCustomerConsentByIdAndTenant(input.tenantId, input.consentId);
    if (!existing) throw new NotFoundException('Consentimiento no encontrado.');
    if (input.customerId && String(existing.customerId) !== input.customerId) {
      throw new ForbiddenException('El consentimiento no corresponde al cliente autenticado.');
    }
    const consent = await this.repository.revokeCustomerConsent(input.tenantId, input.consentId, new Date());
    if (!consent) throw new NotFoundException('Consentimiento no encontrado.');
    return { id: String(consent.id), customerId: String(consent.customerId), revoked: true, revokedAt: consent.revokedAt };
  }

  async getProviderRequest(input: { tenantId: string; requestId: string }) {
    const request = await this.repository.findProviderRequestByIdAndTenant(input.tenantId, input.requestId);
    if (!request) throw new NotFoundException('Solicitud de provider externo no encontrada.');
    const responses = await this.repository.findProviderResponsesByRequestIdAndTenant(input.tenantId, input.requestId);
    return {
      id: String(request.id),
      providerId: request.providerId ? String(request.providerId) : null,
      customerId: request.customerId ? String(request.customerId) : null,
      requestType: request.requestType,
      purposeCode: request.purposeCode,
      decisionStage: request.decisionStage,
      modeUsed: request.modeUsed,
      responseStatus: request.responseStatus,
      responseCode: request.responseCode,
      approvalStatus: request.approvalStatus,
      estimatedCostAmount: request.estimatedCostAmount,
      actualCostAmount: request.actualCostAmount,
      currency: request.currency,
      requestedAt: request.requestedAt,
      respondedAt: request.respondedAt,
      latencyMs: request.latencyMs,
      errorMessageSafe: request.errorMessageSafe,
      metadataJson: request.metadataJson,
      responses: responses.map((response) => ({
        id: String(response.id),
        providerStatusCode: response.providerStatusCode,
        providerReference: response.providerReference,
        responseHash: response.responseHash,
        redactedPayloadJson: response.redactedPayloadJson,
        normalizedPayloadJson: response.normalizedPayloadJson,
        createdAt: response.createdAtValue,
      })),
    };
  }

  async getCustomerObservations(input: { tenantId: string; customerId: string; limit?: number }) {
    const observations = await this.repository.listCustomerObservations(input.tenantId, input.customerId, input.limit ?? 50);
    return observations.map((observation) => ({
      id: String(observation.id),
      customerId: observation.customerId ? String(observation.customerId) : null,
      observationCode: observation.observationCode,
      valueText: observation.valueText,
      valueNumber: observation.valueNumber,
      valueBoolean: observation.valueBoolean,
      valueJson: observation.valueJson,
      sourceProviderId: observation.sourceProviderId ? String(observation.sourceProviderId) : null,
      confidenceScore: observation.confidenceScore,
      verificationStatus: observation.verificationStatus,
      capturedAt: observation.capturedAt,
      derivationMethod: observation.derivationMethod,
    }));
  }

  async getCustomerFeatures(input: { tenantId: string; customerId: string; limit?: number }) {
    const snapshots = await this.repository.listCustomerFeatureSnapshots(input.tenantId, input.customerId, input.limit ?? 20);
    return snapshots.map((snapshot) => ({
      id: String(snapshot.id),
      customerId: snapshot.customerId ? String(snapshot.customerId) : null,
      snapshotReason: snapshot.snapshotReason,
      triggeringEntityId: snapshot.triggeringEntityId ? String(snapshot.triggeringEntityId) : null,
      featureSetVersion: snapshot.featureSetVersion,
      featuresJson: snapshot.featuresJson,
      missingFeaturesJson: snapshot.missingFeaturesJson,
      integrityHash: snapshot.integrityHash,
      createdAt: snapshot.createdAtValue,
    }));
  }

  async getProviderCostPolicies(providerCode: string) {
    const provider = await this.requireProvider(toProviderCode(providerCode));
    const policies = await this.repository.listCostPolicies(String(provider.id));
    return policies.map((policy) => this.mapCostPolicy(policy));
  }

  async updateProviderCostPolicy(input: {
    providerCode: string;
    queryType: string;
    patch: Partial<{
      unitCostAmount: number;
      currency: string;
      costTier: string;
      maxQueriesPerUserPerDay: number | null;
      maxQueriesPerUserPerMonth: number | null;
      maxQueriesGlobalPerDay: number | null;
      allowedDecisionStagesJson: string[];
      requiresManualApproval: boolean;
      requiresAdminRole: boolean;
      blockByDefault: boolean;
      cacheTtlSeconds: number | null;
      featureTtlSeconds: number | null;
      retryMaxAttempts: number | null;
      retryBackoffSeconds: number | null;
      active: boolean;
    }>;
  }) {
    const provider = await this.requireProvider(toProviderCode(input.providerCode));
    const policy = await this.repository.updateCostPolicy(String(provider.id), input.queryType.toUpperCase(), input.patch);
    if (!policy) throw new NotFoundException('Política de costo no encontrada.');
    return this.mapCostPolicy(policy);
  }

  executeQrPayment(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'QR_GENERIC',
        queryType: 'PAYMENT_VERIFICATION',
        purpose: 'PAYMENT_RECONCILIATION',
        decisionStage: 'PAYMENT_RECONCILIATION',
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }

  executeBankTransfer(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'BANKING_GENERIC',
        queryType: 'BANK_TRANSFER_VERIFICATION',
        purpose: 'PAYMENT_RECONCILIATION',
        decisionStage: 'PAYMENT_RECONCILIATION',
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }

  executeTelcoPhoneTrust(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'TELCO_GENERIC',
        queryType: 'PHONE_TRUST_CHECK',
        purpose: 'FRAUD_PREVENTION',
        decisionStage: 'ONBOARDING',
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }

  executeWhatsapp(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'WHATSAPP_GENERIC',
        queryType: 'WHATSAPP_OTP_VERIFICATION',
        purpose: 'CONTACTABILITY',
        decisionStage: 'CONTACTABILITY',
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }

  executeDigitalTrust(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'DIGITAL_TRUST_GENERIC',
        queryType: 'DIGITAL_TRUST_CHECK',
        purpose: 'DIGITAL_TRUST',
        decisionStage: 'ONBOARDING',
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }

  createFacebookConnectUrl(input: { tenantId: string; customerId: string }) {
    const state = sha256Hex(`${input.tenantId}:${input.customerId}:${Date.now()}`).slice(0, 32);
    return {
      customerId: input.customerId,
      providerCode: 'FACEBOOK_META',
      mode: toMode(process.env.FACEBOOK_META_MODE ?? process.env.META_FACEBOOK_MODE ?? 'mock_local'),
      state,
      connectUrl: `/mock/facebook/oauth/authorize?state=${state}&customerId=${input.customerId}`,
      note: 'URL contractual para mock/sandbox. En producción debe generarse con OAuth oficial de Meta y scopes mínimos.',
    };
  }

  executeFacebookCallback(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'FACEBOOK_META',
        queryType: 'SOCIAL_TRUST_CHECK',
        purpose: 'DIGITAL_TRUST',
        decisionStage: 'ONBOARDING',
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }

  async retryProviderRequest(input: {
    tenantId: string;
    requestId: string;
    body: Partial<ExternalDataRequestDto> & { input?: Record<string, unknown> };
    requestedByUserId?: string;
  }) {
    const original = await this.repository.findProviderRequestByIdAndTenant(input.tenantId, input.requestId);
    if (!original) throw new NotFoundException('Solicitud de provider externo no encontrada.');
    const originalProvider = original.providerId ? await this.repository.findProviderById(String(original.providerId)) : null;
    const providerCode = toProviderCode(input.body.providerCode ?? String(originalProvider?.providerCode ?? ''));
    if (!input.body.input) {
      throw new BadRequestException(
        'RETRY_REQUIRES_NEW_INPUT: por privacidad no se guarda el input claro original; reenvía input sanitizado.',
      );
    }
    return this.executeExternalDataRequest({
      tenantId: input.tenantId,
      requestedByUserId: input.requestedByUserId,
      retryOfRequestId: input.requestId,
      body: {
        customerId: input.body.customerId ?? (original.customerId ? String(original.customerId) : undefined),
        providerCode,
        queryType: input.body.queryType ?? String(original.requestType ?? ''),
        purpose: input.body.purpose ?? String(original.purposeCode ?? 'MANUAL_REVIEW'),
        decisionStage: input.body.decisionStage ?? String(original.decisionStage ?? 'MANUAL_REVIEW'),
        input: input.body.input,
        scenario: input.body.scenario,
        approvedByAdminId: input.body.approvedByAdminId,
        forceRefresh: true,
      },
    });
  }

  async getCustomerScoringInput(input: { tenantId: string; customerId: string }) {
    const snapshots = await this.repository.listCustomerFeatureSnapshots(input.tenantId, input.customerId, 50);
    const maxAgeHours = envNumber('EXTERNAL_FEATURE_MAX_AGE_HOURS', 168);
    const now = Date.now();
    const features: Record<string, unknown> = {};
    const missing: Record<string, unknown> = {};
    const freshness: Array<{ snapshotId: string; snapshotReason: string | null; ageHours: number; stale: boolean }> = [];
    for (const snapshot of [...snapshots].reverse()) {
      Object.assign(features, snapshot.featuresJson ?? {});
      Object.assign(missing, snapshot.missingFeaturesJson ?? {});
      const ageHours = snapshot.createdAtValue ? Math.round(((now - snapshot.createdAtValue.getTime()) / 3_600_000) * 100) / 100 : 0;
      freshness.push({
        snapshotId: String(snapshot.id),
        snapshotReason: snapshot.snapshotReason,
        ageHours,
        stale: ageHours > maxAgeHours,
      });
    }
    return {
      customerId: input.customerId,
      generatedAt: new Date().toISOString(),
      featureSource: 'risk_feature_snapshots_only',
      maxAgeHours,
      features,
      missing,
      freshness,
      qualityFlags: {
        hasExternalFeatures: Object.keys(features).length > 0,
        hasStaleFeatures: freshness.some((item) => item.stale),
        rawProviderAccessBlocked: true,
        scoringMayCallProvidersDirectly: false,
      },
    };
  }

  async getProviderUsage(input: { tenantId?: string; providerCode?: string; days: number }) {
    const provider = input.providerCode ? await this.requireProvider(toProviderCode(input.providerCode)) : null;
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
      { providerCode: string; total: number; executed: number; blocked: number; cached: number; actualCost: number; estimatedCost: number }
    >();
    for (const request of requests) {
      const code = providerById.get(String(request.providerId)) ?? 'UNKNOWN';
      const item = summary.get(code) ?? {
        providerCode: code,
        total: 0,
        executed: 0,
        blocked: 0,
        cached: 0,
        actualCost: 0,
        estimatedCost: 0,
      };
      item.total += 1;
      if (['COMPLETED', 'MOCKED', 'DATA_NOT_AVAILABLE'].includes(String(request.responseStatus))) item.executed += 1;
      if (
        ['BLOCKED_BY_COST_POLICY', 'CONSENT_REQUIRED', 'MANUAL_APPROVAL_REQUIRED', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(
          String(request.responseStatus),
        )
      )
        item.blocked += 1;
      if (request.responseStatus === 'CACHED') item.cached += 1;
      item.actualCost += Number(request.actualCostAmount ?? 0);
      item.estimatedCost += Number(request.estimatedCostAmount ?? 0);
      summary.set(code, item);
    }
    return {
      generatedAt: new Date().toISOString(),
      days: input.days,
      providerCode: input.providerCode ?? 'ALL',
      summary: [...summary.values()],
    };
  }

  async auditIdempotencyKeys(input: { tenantId: string; days: number; limit: number }) {
    const from = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const requests = await this.repository.listIdempotencyAuditRequests({ tenantId: input.tenantId, from, limit: input.limit });
    const grouped = new Map<
      string,
      Array<{
        requestId: string;
        providerId: string | null;
        customerId: string | null;
        requestType: string | null;
        purposeCode: string | null;
        decisionStage: string | null;
        requestPayloadHash: string | null;
        responseStatus: string | null;
        requestedAt: Date | null;
      }>
    >();
    for (const request of requests) {
      const key = String(request.idempotencyKey ?? '');
      if (!key) continue;
      const items = grouped.get(key) ?? [];
      items.push({
        requestId: String(request.id),
        providerId: request.providerId ? String(request.providerId) : null,
        customerId: request.customerId ? String(request.customerId) : null,
        requestType: request.requestType,
        purposeCode: request.purposeCode,
        decisionStage: request.decisionStage,
        requestPayloadHash: request.requestPayloadHash,
        responseStatus: request.responseStatus,
        requestedAt: request.requestedAt,
      });
      grouped.set(key, items);
    }
    const findings: Array<{ severity: 'LOW' | 'HIGH'; idempotencyKeyHash: string; message: string; requests: unknown[] }> = [];
    for (const [key, items] of grouped.entries()) {
      if (items.length < 2) continue;
      const signatures = new Set(
        items.map((item) =>
          [item.providerId, item.customerId, item.requestType, item.purposeCode, item.decisionStage, item.requestPayloadHash].join('|'),
        ),
      );
      findings.push({
        severity: signatures.size > 1 ? 'HIGH' : 'LOW',
        idempotencyKeyHash: sha256Hex(key),
        message:
          signatures.size > 1
            ? 'La misma idempotency key aparece asociada a solicitudes distintas. Esto puede causar replay incorrecto o doble costo.'
            : 'La misma idempotency key fue reutilizada para la misma solicitud. Es aceptable si fue replay auditado.',
        requests: items,
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
    const provider = await this.requireProviderAllowDisabled(toProviderCode(input.providerCode));
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
        responseStatus: request.responseStatus,
        requestedAt: request.requestedAt,
        safeAction: 'PURGE_OR_ARCHIVE_REDACTED_RESPONSE_AFTER_LEGAL_REVIEW',
      })),
      note: 'Preview no destructivo. No purga datos; sirve para revisar retención antes de un job formal aprobado por legal/compliance.',
    };
  }

  async auditResponseSanitization(input: { limit: number }) {
    const responses = await this.repository.listRecentProviderResponses(input.limit);
    const suspiciousKeys = /(documentNumber|phoneNumber|email|otp|token|accessToken|password|secret|authorization|rawPayload)/i;
    const findings: Array<{ responseId: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; keyPath: string; message: string }> = [];
    const scan = (value: unknown, responseId: string, path: string): void => {
      if (Array.isArray(value)) value.forEach((item, index) => scan(item, responseId, `${path}[${index}]`));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
          const keyPath = path ? `${path}.${key}` : key;
          if (suspiciousKeys.test(key) && nested !== '[REDACTED]') {
            findings.push({ responseId, severity: 'HIGH', keyPath, message: 'Clave sensible no aparece redactada.' });
          }
          scan(nested, responseId, keyPath);
        }
      }
    };
    for (const response of responses) scan(response.redactedPayloadJson, String(response.id), 'redactedPayloadJson');
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
    const provider = input.providerCode ? await this.requireProviderAllowDisabled(toProviderCode(input.providerCode)) : null;
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

  async getCustomerDecisionPackage(input: {
    tenantId: string;
    customerId: string;
    includeRawResponses: boolean;
    featureMaxAgeHours?: number;
  }) {
    const maxAgeHours = input.featureMaxAgeHours ?? envNumber('EXTERNAL_FEATURE_MAX_AGE_HOURS', 168);
    const [features, observations, consents] = await Promise.all([
      this.getCustomerScoringInput({ tenantId: input.tenantId, customerId: input.customerId }),
      this.getCustomerObservations({ tenantId: input.tenantId, customerId: input.customerId, limit: 100 }),
      this.listCustomerConsents({ tenantId: input.tenantId, customerId: input.customerId }),
    ]);
    const requests = await this.repository.listProviderRequests({
      tenantId: input.tenantId,
      customerId: input.customerId,
      from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      limit: 100,
    });
    const latestRequests = await Promise.all(
      requests.slice(0, 20).map(async (request) => {
        const responses = input.includeRawResponses ? await this.repository.findProviderResponsesByRequestId(String(request.id)) : [];
        return {
          requestId: String(request.id),
          providerId: request.providerId ? String(request.providerId) : null,
          requestType: request.requestType,
          decisionStage: request.decisionStage,
          modeUsed: request.modeUsed,
          responseStatus: request.responseStatus,
          responseCode: request.responseCode,
          requestedAt: request.requestedAt,
          respondedAt: request.respondedAt,
          cost: request.actualCostAmount ?? request.estimatedCostAmount ?? null,
          currency: request.currency,
          responses: responses.map((response) => ({
            responseId: String(response.id),
            responseHash: response.responseHash,
            providerReference: response.providerReference,
            redactedPayloadJson: response.redactedPayloadJson,
            normalizedPayloadJson: response.normalizedPayloadJson,
          })),
        };
      }),
    );
    const missingCoreFeatures = CORE_SCORING_FEATURES.filter((feature) => !(feature in features.features));
    const staleFeatureSnapshots = features.freshness.filter((item) => item.ageHours > maxAgeHours);
    return {
      customerId: input.customerId,
      generatedAt: new Date().toISOString(),
      packageVersion: 'external-data-decision-package-v5',
      scoringInput: { ...features, maxAgeHours },
      observations,
      consents,
      latestRequests,
      riskFlags: {
        missingCoreFeatures,
        hasMissingCoreFeatures: missingCoreFeatures.length > 0,
        staleFeatureSnapshots,
        hasStaleFeatureSnapshots: staleFeatureSnapshots.length > 0,
        blockedRequestsCount: requests.filter((request) =>
          ['BLOCKED_BY_COST_POLICY', 'CONSENT_REQUIRED', 'MANUAL_APPROVAL_REQUIRED', 'RATE_LIMITED'].includes(
            String(request.responseStatus),
          ),
        ).length,
        failedRequestsCount: requests.filter((request) =>
          ['FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTH_FAILED'].includes(String(request.responseStatus)),
        ).length,
      },
      guidance: [
        'Usar este paquete para revisión manual o scoring; no llamar providers desde scoring.',
        'Si faltan features núcleo, ejecutar preflight antes de consultar proveedores costosos.',
        'Si hay snapshots obsoletos, usar forceRefresh solo cuando costo y consentimiento lo permitan.',
      ],
    };
  }

  async rebuildFeatureSnapshotFromRequest(input: { tenantId: string; requestId: string }) {
    const request = await this.repository.findProviderRequestByIdAndTenant(input.tenantId, input.requestId);
    if (!request) throw new NotFoundException('Solicitud de provider externo no encontrada.');
    if (!request.customerId) throw new BadRequestException('REQUEST_WITHOUT_CUSTOMER_CANNOT_REBUILD_FEATURES');
    const responses = await this.repository.findProviderResponsesByRequestIdAndTenant(input.tenantId, input.requestId);
    const normalized = responses[0]?.normalizedPayloadJson ?? {};
    const observations = Array.isArray(normalized.observations) ? (normalized.observations as NormalizedExternalObservation[]) : [];
    if (observations.length === 0) throw new BadRequestException('REQUEST_HAS_NO_NORMALIZED_OBSERVATIONS_TO_REBUILD');
    const provider = request.providerId ? await this.repository.findProviderById(String(request.providerId)) : null;
    const providerCode = provider ? String(provider.providerCode) : 'UNKNOWN';
    const features = featuresFromObservations(observations);
    const missingFeaturesJson = observations
      .filter((observation) => observation.valueString === 'DATA_NOT_AVAILABLE')
      .reduce<Record<string, unknown>>((acc, observation) => {
        acc[observation.featureKey] = 'DATA_NOT_AVAILABLE';
        return acc;
      }, {});
    const snapshot = await this.repository.createFeatureSnapshot({
      tenantId: input.tenantId,
      customerId: String(request.customerId),
      providerCode,
      requestId: input.requestId,
      featuresJson: features,
      missingFeaturesJson,
      integrityHash: sha256Hex(stableStringify(features)),
      now: new Date(),
    });
    return {
      requestId: input.requestId,
      providerCode,
      rebuilt: true,
      featureSnapshotId: String(snapshot.id),
      features,
      missingFeaturesJson,
      note: 'Reconstrucción no consulta al proveedor y no duplica costo. Útil cuando se corrige scoring input o mapeo de features.',
    };
  }

  private requireAdapter(providerCode: string): ExternalProviderAdapter {
    const adapter = this.adapters.get(providerCode);
    if (!adapter) throw new BadRequestException(`Provider no soportado por adapter: ${providerCode}`);
    return adapter;
  }

  private async requireProvider(providerCode: string) {
    const provider = await this.repository.findProviderByCode(providerCode === 'CGIP' ? 'SEGIP' : providerCode);
    if (!provider) throw new NotFoundException(`Provider externo no configurado: ${providerCode}`);
    if (provider.isActive === false || provider.providerStatus === 'DISABLED') throw new UnprocessableEntityException('PROVIDER_DISABLED');
    return provider;
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

  private assertIdempotencyScopeMatches(
    existing: Awaited<ReturnType<ExternalDataRepository['findIdempotentProviderRequest']>>,
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

  private async replayIdempotentResult(
    existing: Awaited<ReturnType<ExternalDataRepository['findIdempotentProviderRequest']>>,
    providerCode: ExternalProviderCode,
  ): Promise<ExternalDataRequestResult> {
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

  private async evaluateCircuitBreaker(input: {
    providerId: string;
    providerCode: string;
    mode: ExternalProviderMode;
  }): Promise<{ blocked: boolean; status: ExternalProviderStatus; reasonCode: string }> {
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

  private async evaluateQuotaPolicy(input: {
    providerId: string;
    providerCode: string;
    customerId?: string;
    policy: Awaited<ReturnType<ExternalDataRepository['findCostPolicy']>>;
  }): Promise<{ blocked: boolean; status: ExternalProviderStatus; reasonCode: string }> {
    const policy = input.policy;
    if (!policy) return { blocked: false, status: 'PENDING', reasonCode: 'NO_POLICY_CONFIGURED_ALLOWING_DEFAULT' };
    const countableStatuses = ['COMPLETED', 'MOCKED', 'PENDING', 'MANUAL_APPROVAL_REQUIRED'];
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
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

  private cacheTtlSeconds(policy: Awaited<ReturnType<ExternalDataRepository['findCostPolicy']>>): number {
    return policyNumber(policy?.cacheTtlSeconds, envNumber('EXTERNAL_PROVIDER_CACHE_TTL_SECONDS', 0));
  }

  private async requireProviderAllowDisabled(providerCode: string) {
    const provider = await this.repository.findProviderByCode(providerCode === 'CGIP' ? 'SEGIP' : providerCode);
    if (!provider) throw new NotFoundException(`Provider externo no configurado: ${providerCode}`);
    return provider;
  }

  private evaluateCostPolicy(input: {
    providerCode: string;
    policy: Awaited<ReturnType<ExternalDataRepository['findCostPolicy']>>;
    decisionStage: string;
    approvedByAdminId?: string;
  }): { blocked: boolean; status: ExternalProviderStatus; reasonCode: string } {
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
