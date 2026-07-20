import { describe, expect, it } from '@jest/globals';
import { InfoCenterAdapter } from '../../../src/modules/external-data/infrastructure/adapters/infocenter/infocenter.adapter.js';

/** `InfoCenterAdapter` (buró de crédito). execute por escenario en local; normalize con ramas de dato ausente. */
describe('InfoCenterAdapter', () => {
  const adapter = new InfoCenterAdapter();
  const local = (scenario?: string) => ({ mode: 'local', providerCode: 'INFOCENTER', input: scenario ? { scenario } : {} }) as never;

  it('execute lanza en disabled/production y genera payloads por escenario en local', async () => {
    await expect(adapter.execute({ mode: 'disabled', input: {} } as never)).rejects.toThrow('INFOCENTER_PROVIDER_DISABLED');
    await expect(adapter.execute({ mode: 'production', input: {} } as never)).rejects.toThrow('INFOCENTER_REAL_INTEGRATION_NOT_CONFIGURED');
    expect((await adapter.execute(local())).status).toBe('COMPLETED');
    expect((await adapter.execute(local('cost_blocked'))).status).toBe('BLOCKED_BY_COST_POLICY');
    expect((await adapter.execute(local('not_found'))).status).toBe('NOT_FOUND');
  });

  it('normalize (COMPLETED con score) marca verificado', async () => {
    const obs = await adapter.normalize({
      status: 'COMPLETED',
      payload: { status: 'COMPLETED', bureauScore: 680, activeDebtCount: 2, maxDaysPastDue12m: 0 },
    } as never);
    expect(obs.find((o) => o.observationKey === 'bureau_report_status')).toMatchObject({ verified: true, manualReviewRequired: false });
    expect(obs.find((o) => o.observationKey === 'bureau_score_external')).toMatchObject({
      valueType: 'NUMBER',
      valueNumber: 680,
      verified: true,
    });
  });

  it('normalize sin datos -> valueType STRING con DATA_NOT_AVAILABLE y no verificado', async () => {
    const obs = await adapter.normalize({ status: 'DATA_NOT_AVAILABLE', payload: { status: 'DATA_NOT_AVAILABLE' } } as never);
    const score = obs.find((o) => o.observationKey === 'bureau_score_external');
    expect(score).toMatchObject({ valueType: 'STRING', valueString: 'DATA_NOT_AVAILABLE', verified: false });
    expect(obs.find((o) => o.observationKey === 'bureau_report_status')).toMatchObject({ verified: false, manualReviewRequired: true });
  });

  it('normalize marca manualReview cuando maxDaysPastDue12m > 30', async () => {
    const obs = await adapter.normalize({
      status: 'COMPLETED',
      payload: { status: 'COMPLETED', bureauScore: 500, maxDaysPastDue12m: 45 },
    } as never);
    expect(obs.find((o) => o.observationKey === 'bureau_days_past_due_max_12m')).toMatchObject({
      valueNumber: 45,
      manualReviewRequired: true,
    });
  });
});
