import { describe, expect, it } from '@jest/globals';
import { BankingGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/banking-generic/banking-generic.adapter.js';

/** `BankingGenericAdapter` (transferencia bancaria). happy_path (VERIFIED) vs PENDING; normalize con datos ausentes. */
describe('BankingGenericAdapter', () => {
  const adapter = new BankingGenericAdapter();
  const local = (scenario?: string) => ({ mode: 'local', providerCode: 'BANKING_GENERIC', input: scenario ? { scenario } : {} }) as never;

  it('execute lanza en disabled; happy_path -> VERIFIED, otro escenario -> PENDING', async () => {
    await expect(adapter.execute({ mode: 'disabled', input: {} } as never)).rejects.toThrow('BANKING_PROVIDER_DISABLED');
    expect((await adapter.execute(local('happy_path'))).status).toBe('VERIFIED');
    expect((await adapter.execute(local('anything'))).status).toBe('PENDING');
  });

  it('normalize (VERIFIED, matches true) verifica y reconcilia como MATCHED', async () => {
    const obs = await adapter.normalize({
      status: 'VERIFIED',
      payload: { status: 'VERIFIED', amountMatches: true, referenceMatches: true },
    } as never);
    expect(obs.find((o) => o.observationKey === 'bank_transfer_status')).toMatchObject({ verified: true });
    expect(obs.find((o) => o.observationKey === 'payment_amount_match')).toMatchObject({
      valueType: 'BOOLEAN',
      valueBoolean: true,
      verified: true,
    });
    expect(obs.find((o) => o.observationKey === 'reconciliation_status')).toMatchObject({ valueString: 'MATCHED', verified: true });
  });

  it('normalize con matches null/undefined -> STRING DATA_NOT_AVAILABLE; false -> revisión manual', async () => {
    const pending = await adapter.normalize({
      status: 'PENDING',
      payload: { status: 'PENDING', amountMatches: null, referenceMatches: null },
    } as never);
    expect(pending.find((o) => o.observationKey === 'payment_amount_match')).toMatchObject({
      valueType: 'STRING',
      valueString: 'DATA_NOT_AVAILABLE',
      verified: false,
    });
    expect(pending.find((o) => o.observationKey === 'reconciliation_status')).toMatchObject({ valueString: 'PENDING' });

    const failed = await adapter.normalize({
      status: 'FAILED',
      payload: { status: 'FAILED', amountMatches: false, referenceMatches: false },
    } as never);
    expect(failed.find((o) => o.observationKey === 'bank_transfer_status')).toMatchObject({ manualReviewRequired: true });
    expect(failed.find((o) => o.observationKey === 'payment_amount_match')).toMatchObject({ manualReviewRequired: true });
  });
});
