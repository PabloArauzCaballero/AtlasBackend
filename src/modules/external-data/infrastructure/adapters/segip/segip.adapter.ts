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
export class SegipAdapter implements ExternalProviderAdapter {
  providerCode = 'SEGIP';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  async execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult> {
    if (request.mode === 'mock_server') return callMockServer(request, '/identity/verify');
    if (request.mode === 'disabled') throw new Error('SEGIP_PROVIDER_DISABLED');
    if (request.mode === 'production' || request.mode === 'sandbox') throw new Error('SEGIP_REAL_INTEGRATION_NOT_CONFIGURED');

    const scenario = scenarioFromInput(request);
    const started = Date.now();
    const base = {
      provider: 'SEGIP',
      providerReference: `SEGIP-LOCAL-${Date.now()}`,
    };

    const payloadByScenario: Record<string, Record<string, unknown>> = {
      happy_path: {
        ...base,
        status: 'FOUND',
        documentExists: true,
        nameMatches: true,
        birthDateMatches: true,
        extensionMatches: true,
        complementMatches: true,
        matchScore: 0.98,
      },
      partial_match: {
        ...base,
        status: 'PARTIAL_MATCH',
        documentExists: true,
        nameMatches: false,
        birthDateMatches: true,
        extensionMatches: true,
        complementMatches: true,
        matchScore: 0.62,
        manualReviewRequired: true,
      },
      not_found: {
        ...base,
        status: 'NOT_FOUND',
        documentExists: false,
        matchScore: 0,
        manualReviewRequired: true,
      },
      data_not_available: { ...base, status: 'DATA_NOT_AVAILABLE', reasonCode: 'SEGIP_DATA_NOT_AVAILABLE' },
      provider_down: { ...base, status: 'PROVIDER_UNAVAILABLE', reasonCode: 'SEGIP_UNAVAILABLE' },
      timeout: { ...base, status: 'PROVIDER_UNAVAILABLE', reasonCode: 'SEGIP_TIMEOUT' },
    };

    const payload = payloadByScenario[scenario] ?? payloadByScenario.happy_path;
    return {
      providerCode: this.providerCode,
      status: str(payload.status) ?? 'FOUND',
      providerReference: str(payload.providerReference),
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  }

  async normalize(raw: ExternalProviderRawResult): Promise<NormalizedExternalObservation[]> {
    const payload = raw.payload;
    const matchScore = num(payload.matchScore) ?? 0;
    const status = str(payload.status) ?? raw.status;
    const manualReview = bool(payload.manualReviewRequired) ?? ['PARTIAL_MATCH', 'NOT_FOUND', 'PROVIDER_UNAVAILABLE'].includes(status);
    const observations: NormalizedExternalObservation[] = [
      {
        observationKey: 'identity_document_exists',
        valueType: 'BOOLEAN',
        valueBoolean: bool(payload.documentExists) ?? status === 'FOUND',
        confidenceScore: matchScore,
        verified: status === 'FOUND',
        manualReviewRequired: manualReview,
        featureNamespace: 'IDENTITY',
        featureKey: 'identity_document_exists',
      },
      {
        observationKey: 'identity_name_match_score',
        valueType: 'NUMBER',
        valueNumber: matchScore,
        confidenceScore: matchScore,
        verified: matchScore >= 0.85,
        manualReviewRequired: manualReview,
        featureNamespace: 'IDENTITY',
        featureKey: 'identity_match_score',
      },
      {
        observationKey: 'identity_birthdate_match',
        valueType: 'BOOLEAN',
        valueBoolean: bool(payload.birthDateMatches),
        confidenceScore: matchScore,
        verified: bool(payload.birthDateMatches) === true,
        manualReviewRequired: manualReview,
        featureNamespace: 'IDENTITY',
        featureKey: 'identity_birthdate_match',
      },
      {
        observationKey: 'identity_verification_status',
        valueType: 'STRING',
        valueString: status === 'FOUND' ? 'VERIFIED' : status,
        confidenceScore: matchScore,
        verified: status === 'FOUND',
        manualReviewRequired: manualReview,
        featureNamespace: 'IDENTITY',
        featureKey: 'identity_verification_status',
      },
      {
        observationKey: 'identity_manual_review_required',
        valueType: 'BOOLEAN',
        valueBoolean: manualReview,
        confidenceScore: matchScore,
        verified: !manualReview,
        manualReviewRequired: manualReview,
        featureNamespace: 'IDENTITY',
        featureKey: 'identity_manual_review_required',
      },
    ];
    return observations;
  }
}
