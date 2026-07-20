import { describe, expect, it } from '@jest/globals';
import { QrGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/qr-generic/qr-generic.adapter.js';

/** `QrGenericAdapter` (pago QR). execute con rama de éxito/fallo por escenario; normalize con 6 observaciones. */
describe('QrGenericAdapter', () => {
  const adapter = new QrGenericAdapter();
  const local = (scenario?: string) => ({ mode: 'local', providerCode: 'QR_GENERIC', input: scenario ? { scenario } : {} }) as never;

  it('execute lanza en disabled; en local devuelve verificado o el estado de fallo del escenario', async () => {
    await expect(adapter.execute({ mode: 'disabled', input: {} } as never)).rejects.toThrow('QR_PROVIDER_DISABLED');
    expect((await adapter.execute(local())).status).toBe('PAYMENT_VERIFIED');
    expect((await adapter.execute(local('not_found'))).status).toBe('PAYMENT_NOT_FOUND');
    expect((await adapter.execute(local('provider_down'))).status).toBe('PROVIDER_UNAVAILABLE');
  });

  it('normalize (verificado) marca verified y sin revisión manual en los matches', async () => {
    const obs = await adapter.normalize({
      status: 'PAYMENT_VERIFIED',
      payload: { status: 'PAYMENT_VERIFIED', amountMatches: true, referenceMatches: true, paidAmount: 600 },
    } as never);
    expect(obs.find((o) => o.observationKey === 'qr_payment_status')).toMatchObject({ verified: true, manualReviewRequired: false });
    expect(obs.find((o) => o.observationKey === 'payment_amount_match')).toMatchObject({ valueBoolean: true, manualReviewRequired: false });
    expect(obs.find((o) => o.observationKey === 'payment_paid_amount')).toMatchObject({ valueType: 'NUMBER', valueNumber: 600 });
  });

  it('normalize (fallo) exige revisión manual, refleja duplicado y datos ausentes', async () => {
    const obs = await adapter.normalize({
      status: 'PAYMENT_NOT_FOUND',
      payload: { status: 'PAYMENT_NOT_FOUND', amountMatches: false, referenceMatches: false, duplicateDetected: true },
    } as never);
    expect(obs.find((o) => o.observationKey === 'qr_payment_status')).toMatchObject({ verified: false, manualReviewRequired: true });
    expect(obs.find((o) => o.observationKey === 'payment_amount_match')).toMatchObject({ manualReviewRequired: true });
    expect(obs.find((o) => o.observationKey === 'payment_duplicate_detected')).toMatchObject({
      valueBoolean: true,
      manualReviewRequired: true,
    });
    expect(obs.find((o) => o.observationKey === 'payment_paid_amount')).toMatchObject({
      valueType: 'STRING',
      valueString: 'DATA_NOT_AVAILABLE',
      verified: false,
    });
  });
});
