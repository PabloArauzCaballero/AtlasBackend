import { describe, expect, it } from '@jest/globals';
import { fraudDecisionSchema } from '../../../src/modules/fraud/fraud.schemas.js';

/** El siguiente estado se expresa en la máquina de estados canónica; los nombres viejos se traducen. */
describe('fraudDecisionSchema.nextCustomerStatus', () => {
  const parse = (nextCustomerStatus: unknown) =>
    fraudDecisionSchema.safeParse({ decision: 'blocked', reasonCode: 'x', nextCustomerStatus });

  it('acepta los estados canónicos', () => {
    for (const s of ['active', 'observed', 'under_review', 'rejected', 'blocked', 'suspended']) expect(parse(s).success).toBe(true);
  });

  it('traduce los nombres que enviaba el portal', () => {
    expect(parse('approved_for_next_step').data?.nextCustomerStatus).toBe('active');
    expect(parse('pending_fraud_review').data?.nextCustomerStatus).toBe('under_review');
  });

  it('rechaza volver al inicio: `registered` no es una transición legal', () => {
    expect(parse('registered').success).toBe(false);
  });

  it('sigue siendo opcional', () => {
    expect(fraudDecisionSchema.safeParse({ decision: 'false_positive' }).success).toBe(true);
  });
});
