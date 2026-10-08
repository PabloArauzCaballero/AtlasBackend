import { describe, expect, it } from '@jest/globals';
import { submitPaymentClaimSchema } from '../../../src/modules/loan-payment-claims/loan-payment-claims.schemas.js';

const base = { installmentId: '11', storageKey: '1/customer-24/PAYMENT_PROOF/x.jpg', contentType: 'image/jpeg' };

describe('submitPaymentClaimSchema: importe', () => {
  it.each(['0', '0.00', '00.0'])('rechaza el importe %s: un aviso por nada bloquearía la cuota', (amount) => {
    expect(submitPaymentClaimSchema.safeParse({ ...base, amount }).success).toBe(false);
  });

  it.each(['0.01', '150', '150.50'])('acepta el importe %s', (amount) => {
    expect(submitPaymentClaimSchema.safeParse({ ...base, amount }).success).toBe(true);
  });
});
