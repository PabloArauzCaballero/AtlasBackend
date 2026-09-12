/**
 * @file AT-024 — el puerto de estado del cliente entrega valores, no permite escribir, y no reactiva a nadie.
 * @business Un consumidor ve estado y elegibilidad; la transición la hace el dueño con la misma regla de siempre.
 * @system Adaptador real con dobles del repositorio y del motor de elegibilidad; máquina de estados real.
 */
import { describe, expect, it } from '@jest/globals';
import { CustomerStateAdapter } from '../../../src/modules/customers/infrastructure/customer-state.adapter.js';
import { canTransition } from '../../../src/modules/customers/customer-lifecycle.constants.js';
import type { CustomerStatePort } from '../../../src/modules/customers/public/index.js';

function build(
  customer: Record<string, unknown> | null,
  assessment = { eligible: false, blockers: [{ code: 'ACCOUNT_NOT_ACTIVE' }], ruleVersion: 'v1', lifecycleStatus: 'blocked' },
) {
  const customers = { findById: async () => customer };
  const eligibility = { evaluate: async () => assessment };
  return new CustomerStateAdapter(customers as never, eligibility as never);
}

describe('CustomerStatePort (AT-024)', () => {
  it('devuelve el estado como valor inmutable sin datos personales', async () => {
    const adapter = build({
      id: 7,
      lifecycleStatus: 'active',
      creditEligibilityStatus: 'eligible',
      eligibilityEvaluatedAt: new Date('2026-09-01'),
      primaryPhoneHash: 'h',
      primaryEmailEncrypted: 'e',
    });
    const state = await adapter.getState('1', '7');
    expect(state).toMatchObject({ tenantId: '1', customerId: '7', lifecycleStatus: 'active', creditEligibilityStatus: 'eligible' });
    expect(Object.isFrozen(state)).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/primaryPhone|Encrypted/);
  });

  it('cliente inexistente: null, no excepción, no estado inventado', async () => {
    expect(await build(null).getState('1', '404')).toBeNull();
  });

  it('el puerto es de sólo lectura: no expone actualización de perfil ni transición', () => {
    const adapter: CustomerStatePort = build(null);
    expect('updateProfile' in adapter).toBe(false);
    expect('transition' in adapter).toBe(false);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).sort()).toEqual(['constructor', 'evaluateEligibility', 'getState']);
  });

  it('cliente bloqueado: la evaluación no lo reactiva (no existe blocked → active directo)', async () => {
    const summary = await build({ id: 7, lifecycleStatus: 'blocked' }).evaluateEligibility('1', '7');
    expect(summary.eligible).toBe(false);
    expect(summary.blockers).toContain('ACCOUNT_NOT_ACTIVE');
    expect(canTransition('blocked', 'active')).toBe(false);
    expect(canTransition('blocked', 'under_review')).toBe(true);
  });

  it('el resumen de elegibilidad lleva sólo códigos, sin campos ni detalles', async () => {
    const summary = await build({ id: 7, lifecycleStatus: 'active' }, {
      eligible: false,
      blockers: [{ code: 'PROFILE_INCOMPLETE', fields: ['birthDate'] }],
      ruleVersion: 'v1',
      lifecycleStatus: 'active',
    } as never).evaluateEligibility('1', '7');
    expect(summary.blockers).toEqual(['PROFILE_INCOMPLETE']);
    expect(JSON.stringify(summary)).not.toContain('birthDate');
  });
});
