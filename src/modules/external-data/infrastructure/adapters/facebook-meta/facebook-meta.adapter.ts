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
export class FacebookMetaAdapter implements ExternalProviderAdapter {
  providerCode = 'FACEBOOK_META';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  async execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult> {
    if (request.mode === 'mock_server') return callMockServer(request, '/me');
    if (request.mode === 'disabled') throw new Error('FACEBOOK_PROVIDER_DISABLED');
    const started = Date.now();
    const scenario = scenarioFromInput(request);
    const payload =
      scenario === 'data_not_available'
        ? {
            provider: 'FACEBOOK_META',
            status: 'CONNECTED',
            profileIdHash: 'mock_hash',
            nameMatchScore: 0.91,
            emailMatch: true,
            accountAgeAvailable: false,
            accountAgeDays: null,
            reasonCode: 'DATA_NOT_AVAILABLE',
          }
        : {
            provider: 'FACEBOOK_META',
            status: 'CONNECTED',
            profileIdHash: 'mock_hash',
            nameMatchScore: 0.93,
            emailMatch: true,
            accountAgeAvailable: false,
            accountAgeDays: null,
            reasonCode: 'DATA_NOT_AVAILABLE',
          };
    return {
      providerCode: this.providerCode,
      status: str(payload.status) ?? 'CONNECTED',
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  }

  async normalize(raw: ExternalProviderRawResult): Promise<NormalizedExternalObservation[]> {
    const payload = raw.payload;
    const nameMatchScore = num(payload.nameMatchScore) ?? 0;
    const ageAvailable = bool(payload.accountAgeAvailable) ?? false;
    return [
      {
        observationKey: 'facebook_connected',
        valueType: 'BOOLEAN',
        valueBoolean: str(payload.status) === 'CONNECTED',
        confidenceScore: 0.8,
        verified: str(payload.status) === 'CONNECTED',
        manualReviewRequired: false,
        featureNamespace: 'SOCIAL',
        featureKey: 'social_account_connected',
      },
      {
        observationKey: 'facebook_name_match_score',
        valueType: 'NUMBER',
        valueNumber: nameMatchScore,
        confidenceScore: nameMatchScore,
        verified: nameMatchScore >= 0.8,
        manualReviewRequired: nameMatchScore < 0.6,
        featureNamespace: 'SOCIAL',
        featureKey: 'social_identity_match_score',
      },
      {
        observationKey: 'facebook_email_match',
        valueType: bool(payload.emailMatch) === undefined ? 'STRING' : 'BOOLEAN',
        valueBoolean: bool(payload.emailMatch),
        valueString: bool(payload.emailMatch) === undefined ? 'DATA_NOT_AVAILABLE' : undefined,
        confidenceScore: bool(payload.emailMatch) === true ? 0.8 : 0.1,
        verified: bool(payload.emailMatch) === true,
        manualReviewRequired: false,
        featureNamespace: 'SOCIAL',
        featureKey: 'social_contact_consistency_score',
      },
      {
        observationKey: 'facebook_account_age_available',
        valueType: 'BOOLEAN',
        valueBoolean: ageAvailable,
        confidenceScore: ageAvailable ? 0.7 : 0,
        verified: ageAvailable,
        manualReviewRequired: false,
        featureNamespace: 'SOCIAL',
        featureKey: 'social_account_age_available',
      },
      {
        observationKey: 'facebook_account_age_days',
        valueType: ageAvailable && num(payload.accountAgeDays) !== undefined ? 'NUMBER' : 'STRING',
        valueNumber: ageAvailable ? num(payload.accountAgeDays) : undefined,
        valueString: ageAvailable ? undefined : 'DATA_NOT_AVAILABLE',
        confidenceScore: ageAvailable ? 0.7 : 0,
        verified: ageAvailable,
        manualReviewRequired: false,
        featureNamespace: 'SOCIAL',
        featureKey: 'social_account_age_score',
      },
    ];
  }
}
