import { describe, expect, it } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { assertIsOwningCustomer, assertOwnCustomerResource } from '../../../src/common/utils/auth/ownership.util.js';
import { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

function user(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return { sub: '1', role: 'customer', ...overrides };
}

describe('assertOwnCustomerResource (ATLAS-AUDIT-027)', () => {
  it('allows a customer to access their own resource', () => {
    expect(() => assertOwnCustomerResource(user({ role: 'customer', customerId: '42' }), '42')).not.toThrow();
  });

  it('blocks a customer from accessing another customer resource', () => {
    expect(() => assertOwnCustomerResource(user({ role: 'customer', customerId: '42' }), '99')).toThrow(ForbiddenException);
  });

  it('allows any non-customer role through regardless of the customerId in the URL', () => {
    for (const role of ['internal_operator', 'risk_analyst', 'admin', 'platform_admin', 'system'] as const) {
      expect(() => assertOwnCustomerResource(user({ role, customerId: undefined }), '99')).not.toThrow();
    }
  });
});

describe('assertIsOwningCustomer (variante estricta)', () => {
  it('allows the owning customer', () => {
    expect(() => assertIsOwningCustomer(user({ role: 'customer', customerId: '42' }), '42')).not.toThrow();
  });

  it('blocks internal roles too, unlike the lenient variant', () => {
    expect(() => assertIsOwningCustomer(user({ role: 'admin' }), '42')).toThrow(ForbiddenException);
  });

  it('blocks a different customer', () => {
    expect(() => assertIsOwningCustomer(user({ role: 'customer', customerId: '1' }), '42')).toThrow(ForbiddenException);
  });
});
