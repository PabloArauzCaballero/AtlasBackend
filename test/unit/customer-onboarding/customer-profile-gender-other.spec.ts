/**
 * @file C6 — el género «Otro» guarda el «¿cuál?» en la versión del perfil.
 * @business «Otro» sin decir cuál no le describe a nadie; y un «¿cuál?» viejo no debe sobrevivir a un cambio de género.
 * @system `CustomerProfileUpdateService.updateProfile` con repositorios dobles; la transacción ejecuta el callback.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CustomerProfileUpdateService } from '../../../src/modules/customer-onboarding/application/customer-profile-update.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

const USER = { role: 'customer', customerId: '10' } as AuthenticatedUser;

function build(actual: Record<string, unknown> | null) {
  const creada: Array<Record<string, unknown>> = [];
  const profileData = {
    findCurrentProfile: jest.fn(async () => actual),
    closeProfileVersion: jest.fn(async () => undefined),
    createProfileVersion: jest.fn(async (values: Record<string, unknown>) => {
      creada.push(values);
      return { id: '99', ...values };
    }),
  };
  const service = new CustomerProfileUpdateService(
    {
      findById: jest.fn(async () => ({ lifecycleStatus: 'active' })),
      updateCurrentProfileVersion: jest.fn(async () => undefined),
    } as never,
    profileData as never,
    {
      findLatestOnboardingFlow: jest.fn(async () => null),
      createOnboardingStepEvent: jest.fn(async () => undefined),
      createOperationalAuditLog: jest.fn(async () => undefined),
    } as never,
    { advance: jest.fn(async () => undefined) } as never,
    { loadFacts: jest.fn(async () => ({ identityVerificationResult: null })) } as never,
    { findActiveConsent: jest.fn(async () => null), createConsent: jest.fn(async () => undefined) } as never,
    { transaction: (cb: (t: unknown) => unknown) => cb({}) } as never,
  );
  const update = (body: Record<string, unknown>) =>
    service.updateProfile({ tenantId: '7', customerId: '10', body: body as never, currentUser: USER, ipAddress: null });
  return { update, creada };
}

describe('Género «Otro» → ¿cuál?', () => {
  it('correcto: other + texto se guarda y se devuelve', async () => {
    const { update, creada } = build(null);
    const r = await update({ genderDeclared: 'other', genderSelfDescribed: 'No binario' });
    expect(creada[0]).toMatchObject({ genderDeclared: 'other', genderSelfDescribed: 'No binario' });
    expect(r).toMatchObject({ genderSelfDescribed: 'No binario' });
  });

  it('límite: guardar otra preferencia sin tocar el género conserva el «¿cuál?»', async () => {
    const { update, creada } = build({ id: '5', genderDeclared: 'other', genderSelfDescribed: 'No binario' });
    await update({ preferredLanguage: 'es' });
    expect(creada[0]).toMatchObject({ genderDeclared: 'other', genderSelfDescribed: 'No binario' });
  });

  it('inválido: pasar a otro género borra el «¿cuál?» anterior', async () => {
    const { update, creada } = build({ id: '5', genderDeclared: 'other', genderSelfDescribed: 'No binario' });
    await update({ genderDeclared: 'female' });
    expect(creada[0]).toMatchObject({ genderDeclared: 'female', genderSelfDescribed: null });
  });
});
