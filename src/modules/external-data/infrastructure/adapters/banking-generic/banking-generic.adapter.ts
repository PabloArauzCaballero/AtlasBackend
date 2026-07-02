import { Injectable } from '@nestjs/common';
import { ExternalProviderAdapter } from '../../../domain/external-provider-adapter.interface.js';
import {
  ExternalProviderExecutionInput,
  ExternalProviderRawResult,
  NormalizedExternalObservation,
  ProviderHealthResult,
} from '../../../domain/external-provider.types.js';
import { bool, callMockServer, checkMockHealth, scenarioFromInput, str } from '../shared/mock-http.util.js';

@Injectable()
export class BankingGenericAdapter implements ExternalProviderAdapter {
  providerCode = 'BANKING_GENERIC';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  async execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult> {
    if (request.mode === 'mock_server') return callMockServer(request, '/transfer/verify');
    if (request.mode === 'disabled') throw new Error('BANKING_PROVIDER_DISABLED');
    const started = Date.now();
    const scenario = scenarioFromInput(request);
    const payload =
      scenario === 'happy_path'
        ? {
            provider: 'BANKING_GENERIC',
            status: 'VERIFIED',
            amountMatches: true,
            referenceMatches: true,
            providerReference: `BANK-LOCAL-${Date.now()}`,
          }
        : {
            provider: 'BANKING_GENERIC',
            status: 'PENDING',
            amountMatches: null,
            referenceMatches: null,
            providerReference: `BANK-LOCAL-${Date.now()}`,
          };
    return {
      providerCode: this.providerCode,
      status: str(payload.status) ?? 'PENDING',
      providerReference: str(payload.providerReference),
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  }

  async normalize(raw: ExternalProviderRawResult): Promise<NormalizedExternalObservation[]> {
    const status = str(raw.payload.status) ?? raw.status;
    const amountMatches = bool(raw.payload.amountMatches);
    const referenceMatches = bool(raw.payload.referenceMatches);
    return [
      {
        observationKey: 'bank_transfer_status',
        valueType: 'STRING',
        valueString: status,
        confidenceScore: status === 'VERIFIED' ? 0.9 : 0.5,
        verified: status === 'VERIFIED',
        manualReviewRequired: status === 'FAILED',
        featureNamespace: 'BANKING',
        featureKey: 'bank_transfer_status',
      },
      {
        observationKey: 'payment_amount_match',
        valueType: amountMatches === undefined ? 'STRING' : 'BOOLEAN',
        valueBoolean: amountMatches,
        valueString: amountMatches === undefined ? 'DATA_NOT_AVAILABLE' : undefined,
        confidenceScore: amountMatches === undefined ? 0 : 0.9,
        verified: amountMatches === true,
        manualReviewRequired: amountMatches === false,
        featureNamespace: 'BANKING',
        featureKey: 'payment_amount_match',
      },
      {
        observationKey: 'payment_reference_match',
        valueType: referenceMatches === undefined ? 'STRING' : 'BOOLEAN',
        valueBoolean: referenceMatches,
        valueString: referenceMatches === undefined ? 'DATA_NOT_AVAILABLE' : undefined,
        confidenceScore: referenceMatches === undefined ? 0 : 0.9,
        verified: referenceMatches === true,
        manualReviewRequired: referenceMatches === false,
        featureNamespace: 'BANKING',
        featureKey: 'payment_reference_match',
      },
      {
        observationKey: 'reconciliation_status',
        valueType: 'STRING',
        valueString: status === 'VERIFIED' ? 'MATCHED' : 'PENDING',
        confidenceScore: status === 'VERIFIED' ? 0.85 : 0.5,
        verified: status === 'VERIFIED',
        manualReviewRequired: false,
        featureNamespace: 'BANKING',
        featureKey: 'reconciliation_status',
      },
    ];
  }
}
