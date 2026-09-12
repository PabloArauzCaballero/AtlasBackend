/**
 * @file Qué PASARÍA si se consultara a un proveedor externo, sin consultarlo.
 * @business Esta pieza sostiene la operación diaria del backend.
 * @system implementa este tramo del módulo.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { redactSensitiveObject, stableStringify } from '../../../common/utils/privacy/redaction.util.js';
import { ExternalDataRepository } from '../external-data.repository.js';
import { ExternalDataRequestDto } from '../external-data.schemas.js';
import { ExternalDataDecisionService } from './external-data-decision.service.js';
import { ExternalProviderRegistryService } from './external-provider-registry.service.js';
import { consentPurposeCodes, productionIntegrationBlockers, providerModeFromEnv, toProviderCode } from './external-data-policy.util.js';

/**
 * Sale de `ExternalDataExecutionService` porque no ejecuta nada: dice qué política aplicaría, qué
 * costaría y si el consentimiento alcanza. Mezclada con la ejecución real, costaba distinguir en
 * qué rama se estaba leyendo — y era la mitad del archivo.
 */
@Injectable()
export class ExternalDataPreviewService {
  constructor(
    private readonly repository: ExternalDataRepository,
    private readonly registry: ExternalProviderRegistryService,
    private readonly resilience: ResilientAdapterExecutorService,
    private readonly decision: ExternalDataDecisionService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

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

  async previewConsentStatus(input: {
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
