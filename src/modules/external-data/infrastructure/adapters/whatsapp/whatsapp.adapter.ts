import { Injectable } from '@nestjs/common';
import { ExternalProviderAdapter } from '../../../domain/external-provider-adapter.interface.js';
import {
  ExternalProviderExecutionInput,
  ExternalProviderRawResult,
  NormalizedExternalObservation,
  ProviderHealthResult,
} from '../../../domain/external-provider.types.js';
import { bool, callMockServer, checkMockHealth, num, scenarioFromInput, str } from '../shared/mock-http.util.js';

@Injectable()
export class WhatsappAdapter implements ExternalProviderAdapter {
  providerCode = 'WHATSAPP_GENERIC';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  async execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult> {
    if (request.mode === 'mock_server') return callMockServer(request, '/verification/confirm');
    if (request.mode === 'disabled') throw new Error('WHATSAPP_PROVIDER_DISABLED');
    const started = Date.now();
    const scenario = scenarioFromInput(request);
    const payload =
      scenario === 'not_found'
        ? { provider: 'WHATSAPP_GENERIC', status: 'NOT_REACHABLE', whatsappReachable: false, phoneMatch: false, contactabilityScore: 0.1 }
        : {
            provider: 'WHATSAPP_GENERIC',
            status: 'OTP_VERIFIED',
            whatsappReachable: true,
            phoneMatch: true,
            contactabilityScore: 0.96,
            accountAgeAvailable: false,
            reasonCode: 'DATA_NOT_AVAILABLE',
          };
    return {
      providerCode: this.providerCode,
      status: str(payload.status) ?? 'OTP_VERIFIED',
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  }

  async normalize(raw: ExternalProviderRawResult): Promise<NormalizedExternalObservation[]> {
    const payload = raw.payload;
    const score = num(payload.contactabilityScore) ?? 0;
    return [
      {
        observationKey: 'whatsapp_reachable',
        valueType: 'BOOLEAN',
        valueBoolean: bool(payload.whatsappReachable) ?? false,
        confidenceScore: score,
        verified: bool(payload.whatsappReachable) === true,
        manualReviewRequired: false,
        featureNamespace: 'MESSAGING',
        featureKey: 'whatsapp_reachable',
      },
      {
        observationKey: 'whatsapp_otp_verified',
        valueType: 'BOOLEAN',
        valueBoolean: str(payload.status) === 'OTP_VERIFIED',
        confidenceScore: score,
        verified: str(payload.status) === 'OTP_VERIFIED',
        manualReviewRequired: false,
        featureNamespace: 'MESSAGING',
        featureKey: 'whatsapp_otp_verified',
      },
      {
        observationKey: 'whatsapp_phone_match',
        valueType: 'BOOLEAN',
        valueBoolean: bool(payload.phoneMatch) ?? false,
        confidenceScore: score,
        verified: bool(payload.phoneMatch) === true,
        manualReviewRequired: bool(payload.phoneMatch) === false,
        featureNamespace: 'MESSAGING',
        featureKey: 'whatsapp_phone_match',
      },
      {
        observationKey: 'whatsapp_contactability_score',
        valueType: 'NUMBER',
        valueNumber: score,
        confidenceScore: score,
        verified: score >= 0.7,
        manualReviewRequired: score < 0.4,
        featureNamespace: 'MESSAGING',
        featureKey: 'whatsapp_contactability_score',
      },
      {
        observationKey: 'whatsapp_account_age_days',
        valueType: 'STRING',
        valueString: 'DATA_NOT_AVAILABLE',
        confidenceScore: 0,
        verified: false,
        manualReviewRequired: false,
        featureNamespace: 'MESSAGING',
        featureKey: 'whatsapp_account_age_score',
      },
    ];
  }
}
