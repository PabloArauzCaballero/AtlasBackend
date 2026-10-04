import { describe, expect, it, jest } from '@jest/globals';
import { encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import { CustomersService } from '../../../src/modules/customers/customers.service.js';

/**
 * «Mis datos» enseñaba el correo como «…—» porque un correo sólo se guarda cifrado y con el dominio en claro.
 * Aquí se descifra DE VERDAD (un sobre real, no un doble del cifrado) y se comprueba lo que sale al cliente.
 */
describe('CustomersService.getCustomerMe · correo enmascarado', () => {
  const dueno = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;

  async function build(contactos: unknown[]) {
    const repository = {
      findById: jest.fn(async (..._a: unknown[]) => ({ id: 'c1' }) as unknown),
      findCurrentProfile: jest.fn(async (..._a: unknown[]) => null as unknown),
      findContactMethods: jest.fn(async (..._a: unknown[]) => contactos as unknown),
      findCustomerConsents: jest.fn(async (..._a: unknown[]) => [] as unknown),
      findLatestRiskResult: jest.fn(async (..._a: unknown[]) => null as unknown),
    };
    const eligibilityRepository = { findLatestOnboardingFlow: jest.fn(async (..._a: unknown[]) => null as unknown) };
    const eligibilityService = {
      evaluate: jest.fn(async (..._a: unknown[]) => ({
        eligible: false,
        blockers: [],
        sections: [],
        completionPercentage: 0,
        nextStep: 'personal_data',
      })),
    };
    return new CustomersService(repository as never, repository as never, eligibilityRepository as never, eligibilityService as never);
  }

  it('el correo sale enmascarado y NUNCA entero', async () => {
    const sobre = await encryptSecretEnvelope('pablo.arauz@gmail.com');
    const servicio = await build([
      {
        id: 8,
        contactType: 'email',
        status: 'verified',
        isPrimary: true,
        valueLast4: null,
        contactValueEncrypted: Buffer.from(sobre, 'utf8'),
      },
    ]);

    const yo = await servicio.getCustomerMe('t1', 'c1', dueno);

    expect(yo.contacts[0]?.maskedValue).toBe('pa***@gmail.com');
    expect(JSON.stringify(yo)).not.toContain('pablo.arauz');
  });

  it('el teléfono no se descifra: ya tiene sus últimos cuatro dígitos', async () => {
    const servicio = await build([
      {
        id: 7,
        contactType: 'phone',
        status: 'verified',
        isPrimary: true,
        valueLast4: '7232',
        contactValueEncrypted: Buffer.from('basura', 'utf8'),
      },
    ]);

    const yo = await servicio.getCustomerMe('t1', 'c1', dueno);

    expect(yo.contacts[0]).toMatchObject({ valueLast4: '7232', maskedValue: null });
  });

  it('un sobre ilegible no tumba la respuesta: ese contacto sale sin valor y el resto sigue', async () => {
    const servicio = await build([
      {
        id: 8,
        contactType: 'email',
        status: 'verified',
        isPrimary: true,
        valueLast4: null,
        contactValueEncrypted: Buffer.from('v2:roto', 'utf8'),
      },
      { id: 7, contactType: 'phone', status: 'verified', isPrimary: false, valueLast4: '7232', contactValueEncrypted: null },
    ]);

    const yo = await servicio.getCustomerMe('t1', 'c1', dueno);

    expect(yo.contacts).toHaveLength(2);
    expect(yo.contacts[0]?.maskedValue).toBeNull();
  });
});
