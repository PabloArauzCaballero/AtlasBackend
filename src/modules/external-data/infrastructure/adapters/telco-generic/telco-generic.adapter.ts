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
export class TelcoGenericAdapter implements ExternalProviderAdapter {
  providerCode = 'TELCO_GENERIC';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  async execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult> {
    if (request.mode === 'mock_server') return callMockServer(request, '/phone-trust/check');
    if (request.mode === 'disabled') throw new Error('TELCO_PROVIDER_DISABLED');
    const started = Date.now();
    const scenario = scenarioFromInput(request);
    const payload =
      scenario === 'fraud_signal_high'
        ? {
            provider: 'TELCO_GENERIC',
            status: 'VERIFIED',
            phoneNumberActive: true,
            lineAgeDays: 3,
            lineAgeBucket: 'NEW',
            recentSimChangeDetected: true,
            simSwapRiskLevel: 'HIGH',
            ownerMatchScore: 0.42,
            manualReviewRequired: true,
          }
        : {
            provider: 'TELCO_GENERIC',
            status: 'VERIFIED',
            phoneNumberActive: true,
            lineAgeDays: 720,
            lineAgeBucket: 'OLD',
            recentSimChangeDetected: false,
            simSwapRiskLevel: 'LOW',
            ownerMatchScore: 0.9,
            manualReviewRequired: false,
          };
    return {
      providerCode: this.providerCode,
      status: str(payload.status) ?? 'VERIFIED',
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  }

  async normalize(raw: ExternalProviderRawResult): Promise<NormalizedExternalObservation[]> {
    const payload = raw.payload;
    const simRisk = str(payload.simSwapRiskLevel) ?? 'UNKNOWN';
    const ownerMatchScore = num(payload.ownerMatchScore) ?? 0;
    const manualReview = bool(payload.manualReviewRequired) ?? simRisk === 'HIGH';
    return [
      {
        observationKey: 'phone_number_active',
        valueType: 'BOOLEAN',
        valueBoolean: bool(payload.phoneNumberActive) ?? false,
        confidenceScore: 0.8,
        verified: bool(payload.phoneNumberActive) === true,
        manualReviewRequired: false,
        featureNamespace: 'TELCO',
        featureKey: 'phone_number_active',
      },
      {
        observationKey: 'phone_line_age_days',
        valueType: num(payload.lineAgeDays) === undefined ? 'STRING' : 'NUMBER',
        valueNumber: num(payload.lineAgeDays),
        valueString: num(payload.lineAgeDays) === undefined ? 'DATA_NOT_AVAILABLE' : undefined,
        confidenceScore: num(payload.lineAgeDays) === undefined ? 0 : 0.75,
        verified: num(payload.lineAgeDays) !== undefined,
        manualReviewRequired: false,
        featureNamespace: 'TELCO',
        featureKey: 'phone_line_age_days',
      },
      {
        observationKey: 'phone_line_age_bucket',
        valueType: 'STRING',
        valueString: str(payload.lineAgeBucket) ?? 'UNKNOWN',
        confidenceScore: 0.75,
        verified: str(payload.lineAgeBucket) !== undefined,
        manualReviewRequired: false,
        featureNamespace: 'TELCO',
        featureKey: 'phone_line_age_bucket',
      },
      {
        observationKey: 'phone_recent_sim_change_detected',
        valueType: 'BOOLEAN',
        valueBoolean: bool(payload.recentSimChangeDetected) ?? false,
        confidenceScore: 0.75,
        verified: true,
        manualReviewRequired: manualReview,
        featureNamespace: 'TELCO',
        featureKey: 'phone_recent_sim_change_detected',
      },
      {
        observationKey: 'phone_sim_swap_risk_level',
        valueType: 'STRING',
        valueString: simRisk,
        confidenceScore: simRisk === 'HIGH' ? 0.8 : 0.7,
        verified: simRisk !== 'UNKNOWN',
        manualReviewRequired: manualReview,
        featureNamespace: 'TELCO',
        featureKey: 'phone_sim_swap_risk_level',
      },
      {
        observationKey: 'phone_number_owner_match_score',
        valueType: 'NUMBER',
        valueNumber: ownerMatchScore,
        confidenceScore: ownerMatchScore,
        verified: ownerMatchScore >= 0.75,
        manualReviewRequired: manualReview,
        featureNamespace: 'TELCO',
        featureKey: 'phone_identity_consistency_score',
      },
    ];
  }
}
