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
export class InfoCenterAdapter implements ExternalProviderAdapter {
  providerCode = 'INFOCENTER';

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult> {
    return checkMockHealth(this.providerCode, mode, mockBaseUrl);
  }

  async execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult> {
    if (request.mode === 'mock_server') return callMockServer(request, '/credit-report');
    if (request.mode === 'disabled') throw new Error('INFOCENTER_PROVIDER_DISABLED');
    if (request.mode === 'production' || request.mode === 'sandbox') throw new Error('INFOCENTER_REAL_INTEGRATION_NOT_CONFIGURED');
    const scenario = scenarioFromInput(request);
    const started = Date.now();
    const payloadByScenario: Record<string, Record<string, unknown>> = {
      happy_path: {
        provider: 'INFOCENTER',
        status: 'COMPLETED',
        bureauScore: 680,
        activeDebtCount: 2,
        maxDaysPastDue12m: 0,
        estimatedCostAmount: 0,
        currency: 'BOB',
        providerReference: `INFOCENTER-LOCAL-${Date.now()}`,
      },
      cost_blocked: {
        provider: 'INFOCENTER',
        status: 'BLOCKED_BY_COST_POLICY',
        reasonCode: 'INFOCENTER_HIGH_COST_REQUIRES_MANUAL_APPROVAL',
        estimatedCostAmount: 0,
        currency: 'BOB',
      },
      not_found: { provider: 'INFOCENTER', status: 'NOT_FOUND', providerReference: `INFOCENTER-LOCAL-${Date.now()}` },
      data_not_available: { provider: 'INFOCENTER', status: 'DATA_NOT_AVAILABLE', reasonCode: 'BUREAU_DATA_NOT_AVAILABLE' },
    };
    const payload = payloadByScenario[scenario] ?? payloadByScenario.happy_path;
    return {
      providerCode: this.providerCode,
      status: str(payload.status) ?? 'COMPLETED',
      providerReference: str(payload.providerReference),
      payload,
      latencyMs: Date.now() - started,
      isMocked: true,
    };
  }

  async normalize(raw: ExternalProviderRawResult): Promise<NormalizedExternalObservation[]> {
    const payload = raw.payload;
    const status = str(payload.status) ?? raw.status;
    const bureauScore = num(payload.bureauScore);
    const maxDpd = num(payload.maxDaysPastDue12m);
    const activeDebtCount = num(payload.activeDebtCount);
    return [
      {
        observationKey: 'bureau_report_status',
        valueType: 'STRING',
        valueString: status,
        confidenceScore: status === 'COMPLETED' ? 0.9 : 0.2,
        verified: status === 'COMPLETED',
        manualReviewRequired: status !== 'COMPLETED',
        featureNamespace: 'CREDIT_BUREAU',
        featureKey: 'bureau_report_status',
      },
      {
        observationKey: 'bureau_score_external',
        valueType: bureauScore === undefined ? 'STRING' : 'NUMBER',
        valueNumber: bureauScore,
        valueString: bureauScore === undefined ? 'DATA_NOT_AVAILABLE' : undefined,
        confidenceScore: bureauScore === undefined ? 0 : 0.85,
        verified: bureauScore !== undefined,
        manualReviewRequired: status !== 'COMPLETED',
        featureNamespace: 'CREDIT_BUREAU',
        featureKey: 'bureau_score_external',
      },
      {
        observationKey: 'bureau_active_debt_count',
        valueType: activeDebtCount === undefined ? 'STRING' : 'NUMBER',
        valueNumber: activeDebtCount,
        valueString: activeDebtCount === undefined ? 'DATA_NOT_AVAILABLE' : undefined,
        confidenceScore: activeDebtCount === undefined ? 0 : 0.85,
        verified: activeDebtCount !== undefined,
        manualReviewRequired: false,
        featureNamespace: 'CREDIT_BUREAU',
        featureKey: 'bureau_active_debt_count',
      },
      {
        observationKey: 'bureau_days_past_due_max_12m',
        valueType: maxDpd === undefined ? 'STRING' : 'NUMBER',
        valueNumber: maxDpd,
        valueString: maxDpd === undefined ? 'DATA_NOT_AVAILABLE' : undefined,
        confidenceScore: maxDpd === undefined ? 0 : 0.85,
        verified: maxDpd !== undefined,
        manualReviewRequired: typeof maxDpd === 'number' && maxDpd > 30,
        featureNamespace: 'CREDIT_BUREAU',
        featureKey: 'bureau_days_past_due_max_12m',
      },
    ];
  }
}
