import { describe, expect, it } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  actorId,
  assertCustomerAccess,
  customerScopeForConsentMutation,
} from '../../../src/modules/external-data/external-data-controller.util.js';

/** Helpers de los controllers de external-data: resolución de actor y guardas de acceso del cliente. */
describe('external-data-controller.util', () => {
  it('actorId prioriza internalUserId > platformUserId > customerId', () => {
    expect(actorId({ internalUserId: 'i', platformUserId: 'p', customerId: 'c' } as never)).toBe('i');
    expect(actorId({ internalUserId: null, platformUserId: 'p', customerId: 'c' } as never)).toBe('p');
    expect(actorId({ internalUserId: null, platformUserId: null, customerId: 'c' } as never)).toBe('c');
  });

  it('assertCustomerAccess: sin customerId no valida; con customerId aplica ownership', () => {
    expect(() => assertCustomerAccess({ role: 'internal_operator' } as never, undefined)).not.toThrow();
    expect(() => assertCustomerAccess({ role: 'customer', customerId: '9' } as never, '9')).not.toThrow();
    expect(() => assertCustomerAccess({ role: 'customer', customerId: '9' } as never, '99')).toThrow();
  });

  it('customerScopeForConsentMutation: undefined para internos, el id para customer, Forbidden sin id', () => {
    expect(customerScopeForConsentMutation({ role: 'internal_operator' } as never)).toBeUndefined();
    expect(customerScopeForConsentMutation({ role: 'customer', customerId: '9' } as never)).toBe('9');
    expect(() => customerScopeForConsentMutation({ role: 'customer' } as never)).toThrow(ForbiddenException);
  });
});
