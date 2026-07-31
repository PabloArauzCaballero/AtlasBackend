/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { ExternalProviderAdapter } from '../../../domain/external-provider-adapter.interface.js';
import {
  ExternalProviderExecutionInput,
  ExternalProviderRawResult,
  NormalizedExternalObservation,
  ProviderHealthResult,
} from '../../../domain/external-provider.types.js';
import { bool, callMockServer, checkMockHealth, scenarioFromInput, str } from '../shared/mock-http.util.js';
import { BankQrInput, BankQrResult, buildTestBankQr, mapMockQrPayload } from './banking-qr.util.js';

@Injectable()
export class BankingGenericAdapter implements ExternalProviderAdapter {
  providerCode = 'BANKING_GENERIC';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  /**
   * Genera un QR de cobro de PRUEBA. En `mock_server` delega en el mock (`/qr/generate`); en
   * `mock_local`/`sandbox` lo genera en proceso (mismo formato). `disabled` y `production` (sin
   * integración real) fallan explícitamente.
   */
  async generateQr(request: ExternalProviderExecutionInput): Promise<BankQrResult> {
    const input: BankQrInput = {
      amount: typeof request.input.amount === 'number' ? request.input.amount : undefined,
      currency: typeof request.input.currency === 'string' ? request.input.currency : undefined,
      reference: typeof request.input.reference === 'string' ? request.input.reference : undefined,
      scenario: request.scenario,
    };
    if (request.mode === 'disabled') throw new Error('BANKING_PROVIDER_DISABLED');
    if (request.mode === 'production') throw new Error('BANKING_QR_PRODUCTION_NOT_IMPLEMENTED');
    if (request.mode === 'mock_server') {
      const raw = await callMockServer(request, '/qr/generate');
      return mapMockQrPayload(raw.payload, input);
    }
    return buildTestBankQr(input);
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
