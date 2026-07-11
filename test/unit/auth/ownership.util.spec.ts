import { describe, expect, it } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  assertIsOwningCustomer,
  assertOwnCustomerResource,
  assertOwnCustomerResourceOrInternalOperational,
} from '../../../src/common/utils/auth/ownership.util.js';
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

describe('assertOwnCustomerResourceOrInternalOperational (usada por customer-onboarding)', () => {
  it('allows the owning customer', () => {
    expect(() => assertOwnCustomerResourceOrInternalOperational(user({ role: 'customer', customerId: '42' }), '42')).not.toThrow();
  });

  it('blocks a customer from accessing another customer resource', () => {
    expect(() => assertOwnCustomerResourceOrInternalOperational(user({ role: 'customer', customerId: '42' }), '99')).toThrow(
      ForbiddenException,
    );
  });

  it('allows internal operational roles through regardless of the customerId (allow-list, not a blanket bypass)', () => {
    for (const role of ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin'] as const) {
      expect(() => assertOwnCustomerResourceOrInternalOperational(user({ role, customerId: undefined }), '99')).not.toThrow();
    }
  });

  it('blocks roles with no onboarding business need, unlike assertOwnCustomerResource (regression: this is the check that must stay stricter)', () => {
    for (const role of ['merchant', 'readonly_auditor', 'qa_engineer', 'devops', 'system_admin', 'system'] as const) {
      expect(() => assertOwnCustomerResourceOrInternalOperational(user({ role, customerId: undefined }), '99')).toThrow(
        ForbiddenException,
      );
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
