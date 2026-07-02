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
export class QrGenericAdapter implements ExternalProviderAdapter {
  providerCode = 'QR_GENERIC';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  async execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult> {
    if (request.mode === 'mock_server') return callMockServer(request, '/payment/verify');
    if (request.mode === 'disabled') throw new Error('QR_PROVIDER_DISABLED');
    const started = Date.now();
    const scenario = scenarioFromInput(request);
    const success = scenario !== 'not_found' && scenario !== 'provider_down' && scenario !== 'timeout';
    const payload = success
      ? {
          provider: 'QR_GENERIC',
          status: 'PAYMENT_VERIFIED',
          amountMatches: true,
          referenceMatches: true,
          paidAmount: 600,
          currency: 'BOB',
          providerReference: `QR-LOCAL-${Date.now()}`,
        }
      : {
          provider: 'QR_GENERIC',
          status: scenario === 'not_found' ? 'PAYMENT_NOT_FOUND' : 'PROVIDER_UNAVAILABLE',
          amountMatches: false,
          referenceMatches: false,
        };
    return {
      providerCode: this.providerCode,
      status: str(payload.status) ?? 'PAYMENT_VERIFIED',
      providerReference: str(payload.providerReference),
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  }

  async normalize(raw: ExternalProviderRawResult): Promise<NormalizedExternalObservation[]> {
    const status = str(raw.payload.status) ?? raw.status;
    const amountMatches = bool(raw.payload.amountMatches) ?? false;
    const referenceMatches = bool(raw.payload.referenceMatches) ?? false;
    const duplicateDetected = bool(raw.payload.duplicateDetected) ?? false;
    return [
      {
        observationKey: 'qr_payment_status',
        valueType: 'STRING',
        valueString: status,
        confidenceScore: status === 'PAYMENT_VERIFIED' ? 0.9 : 0.4,
        verified: status === 'PAYMENT_VERIFIED',
        manualReviewRequired: status !== 'PAYMENT_VERIFIED',
        featureNamespace: 'PAYMENT',
        featureKey: 'qr_payment_status',
      },
      {
        observationKey: 'payment_initial_verified',
        valueType: 'BOOLEAN',
        valueBoolean: status === 'PAYMENT_VERIFIED',
        confidenceScore: 0.9,
        verified: status === 'PAYMENT_VERIFIED',
        manualReviewRequired: false,
        featureNamespace: 'PAYMENT',
        featureKey: 'payment_initial_verified',
      },
      {
        observationKey: 'payment_amount_match',
        valueType: 'BOOLEAN',
        valueBoolean: amountMatches,
        confidenceScore: 0.9,
        verified: amountMatches,
        manualReviewRequired: !amountMatches,
        featureNamespace: 'PAYMENT',
        featureKey: 'payment_amount_match',
      },
      {
        observationKey: 'payment_reference_match',
        valueType: 'BOOLEAN',
        valueBoolean: referenceMatches,
        confidenceScore: 0.9,
        verified: referenceMatches,
        manualReviewRequired: !referenceMatches,
        featureNamespace: 'PAYMENT',
        featureKey: 'payment_reference_match',
      },
      {
        observationKey: 'payment_duplicate_detected',
        valueType: 'BOOLEAN',
        valueBoolean: duplicateDetected,
        confidenceScore: duplicateDetected ? 0.95 : 0.8,
        verified: true,
        manualReviewRequired: duplicateDetected,
        featureNamespace: 'PAYMENT',
        featureKey: 'payment_duplicate_detected',
      },
      {
        observationKey: 'payment_paid_amount',
        valueType: num(raw.payload.paidAmount) === undefined ? 'STRING' : 'NUMBER',
        valueNumber: num(raw.payload.paidAmount),
        valueString: num(raw.payload.paidAmount) === undefined ? 'DATA_NOT_AVAILABLE' : undefined,
        confidenceScore: 0.8,
        verified: num(raw.payload.paidAmount) !== undefined,
        manualReviewRequired: false,
        featureNamespace: 'PAYMENT',
        featureKey: 'payment_paid_amount',
      },
    ];
  }
}
