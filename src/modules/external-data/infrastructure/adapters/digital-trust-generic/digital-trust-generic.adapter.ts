import { Injectable } from '@nestjs/common';
import { ExternalProviderAdapter } from '../../../domain/external-provider-adapter.interface.js';
import {
  ExternalProviderExecutionInput,
  ExternalProviderRawResult,
  NormalizedExternalObservation,
  ProviderHealthResult,
} from '../../../domain/external-provider.types.js';
import { callMockServer, checkMockHealth, num, scenarioFromInput, str } from '../shared/mock-http.util.js';

@Injectable()
export class DigitalTrustGenericAdapter implements ExternalProviderAdapter {
  providerCode = 'DIGITAL_TRUST_GENERIC';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  async execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult> {
    if (request.mode === 'mock_server') return callMockServer(request, '/check');
    if (request.mode === 'disabled') throw new Error('DIGITAL_TRUST_PROVIDER_DISABLED');
    const started = Date.now();
    const scenario = scenarioFromInput(request);
    const payload =
      scenario === 'fraud_signal_high'
        ? {
            provider: 'DIGITAL_TRUST_GENERIC',
            status: 'COMPLETED',
            emailRiskLevel: 'MEDIUM',
            deviceRiskScore: 0.78,
            ipRiskScore: 0.84,
            syntheticIdentityRiskLevel: 'HIGH',
            manualReviewRequired: true,
          }
        : {
            provider: 'DIGITAL_TRUST_GENERIC',
            status: 'COMPLETED',
            emailRiskLevel: 'LOW',
            deviceRiskScore: 0.15,
            ipRiskScore: 0.18,
            syntheticIdentityRiskLevel: 'LOW',
            manualReviewRequired: false,
          };
    return {
      providerCode: this.providerCode,
      status: str(payload.status) ?? 'COMPLETED',
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  }

  async normalize(raw: ExternalProviderRawResult): Promise<NormalizedExternalObservation[]> {
    const payload = raw.payload;
    const syntheticRisk = str(payload.syntheticIdentityRiskLevel) ?? 'UNKNOWN';
    return [
      {
        observationKey: 'email_domain_risk_level',
        valueType: 'STRING',
        valueString: str(payload.emailRiskLevel) ?? 'UNKNOWN',
        confidenceScore: 0.7,
        verified: true,
        manualReviewRequired: str(payload.emailRiskLevel) === 'HIGH',
        featureNamespace: 'DIGITAL_TRUST',
        featureKey: 'email_domain_risk_level',
      },
      {
        observationKey: 'device_reputation_score',
        valueType: 'NUMBER',
        valueNumber: num(payload.deviceRiskScore) ?? 0,
        confidenceScore: 0.75,
        verified: true,
        manualReviewRequired: (num(payload.deviceRiskScore) ?? 0) > 0.7,
        featureNamespace: 'DIGITAL_TRUST',
        featureKey: 'device_reputation_score',
      },
      {
        observationKey: 'ip_risk_score',
        valueType: 'NUMBER',
        valueNumber: num(payload.ipRiskScore) ?? 0,
        confidenceScore: 0.75,
        verified: true,
        manualReviewRequired: (num(payload.ipRiskScore) ?? 0) > 0.7,
        featureNamespace: 'DIGITAL_TRUST',
        featureKey: 'ip_risk_score',
      },
      {
        observationKey: 'synthetic_identity_risk_level',
        valueType: 'STRING',
        valueString: syntheticRisk,
        confidenceScore: syntheticRisk === 'HIGH' ? 0.85 : 0.65,
        verified: syntheticRisk !== 'UNKNOWN',
        manualReviewRequired: syntheticRisk === 'HIGH',
        featureNamespace: 'DIGITAL_TRUST',
        featureKey: 'synthetic_identity_risk_level',
      },
    ];
  }
}
