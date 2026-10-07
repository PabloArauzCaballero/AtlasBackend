import { describe, expect, it } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  actorId,
  assertCustomerAccess,
  customerScopeForConsentMutation,
  inlineApprovalBy,
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

  it('inlineApprovalBy: sólo un admin aprueba en línea, siempre a su nombre; sin señal no hay aprobación', () => {
    const admin = { role: 'admin', internalUserId: 'a1' } as never;
    expect(inlineApprovalBy(admin, '999')).toBe('a1');
    expect(inlineApprovalBy(admin, undefined)).toBeUndefined();
    expect(inlineApprovalBy({ role: 'platform_admin', platformUserId: 'p1' } as never, true)).toBe('p1');
    expect(inlineApprovalBy({ role: 'customer', customerId: '9' } as never, '1')).toBeUndefined();
    expect(inlineApprovalBy({ role: 'risk_analyst', internalUserId: 'r1' } as never, '1')).toBeUndefined();
  });
});
