import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { IdentityDocumentDuplicateService } from '../../../src/modules/customer-onboarding/application/identity-document-duplicate.service.js';
import { hashSensitiveText } from '../../../src/common/utils/crypto/hash.util.js';

/**
 * Carnet repetido en otra cuenta ⇒ se bloquea la IP, el dispositivo y la cuenta, y el alta se corta. Es la
 * defensa contra suplantación de identidad pedida por Pablo (2026-10-19): cambiar de IP o de teléfono no basta.
 */
describe('IdentityDocumentDuplicateService', () => {
  function build(found: { customerId: string } | null, fingerprints: string[] = ['fp-1']) {
    const evidenceRepository = { findIdentityDocumentOfAnotherCustomer: jest.fn(async (..._a: unknown[]) => found) };
    const ipBlock = {
      block: jest.fn(async (..._a: unknown[]) => undefined),
      blockDevice: jest.fn(async (..._a: unknown[]) => undefined),
    };
    const devices = { fingerprintsOfCustomer: jest.fn(async (..._a: unknown[]) => fingerprints) };
    const lifecycle = { advance: jest.fn(async (..._a: unknown[]) => null) };
    const sequelize = { transaction: jest.fn(async (callback: (t: unknown) => Promise<unknown>) => callback({ id: 'tx' })) };
    const service = new IdentityDocumentDuplicateService(
      evidenceRepository as never,
      ipBlock as never,
      devices as never,
      lifecycle as never,
      sequelize as never,
    );
    return { service, evidenceRepository, ipBlock, devices, lifecycle, sequelize };
  }
  const base = { tenantId: 't1', customerId: '10', ipAddress: '200.1.2.3', blockCaller: true };

  it('deja pasar un carnet que no figura en otra cuenta y no bloquea nada', async () => {
    const { service, ipBlock, lifecycle } = build(null);
    await expect(service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' })).resolves.toBeUndefined();
    expect(ipBlock.block).not.toHaveBeenCalled();
    expect(lifecycle.advance).not.toHaveBeenCalled();
  });

  it('si el carnet ya es de otro cliente bloquea IP, dispositivo y cuenta, y responde ONBOARDING_IP_BLOCKED sin confirmar que existe', async () => {
    const { service, ipBlock, lifecycle } = build({ customerId: '99' }, ['fp-1', 'fp-2']);
    const result = service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' });
    await expect(result).rejects.toThrow(ForbiddenException);
    await expect(result).rejects.toThrow('ONBOARDING_IP_BLOCKED');
    expect(ipBlock.block).toHaveBeenCalledWith('200.1.2.3', 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(ipBlock.blockDevice).toHaveBeenCalledWith('fp-1', 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(ipBlock.blockDevice).toHaveBeenCalledWith('fp-2', 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(lifecycle.advance).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        customerId: '10',
        toStatus: 'blocked',
        changedByType: 'system',
        transaction: { id: 'tx' },
      }),
    );
  });

  it('personal interno que envía por un cliente: se rechaza el envío pero no se bloquea nada', async () => {
    const { service, ipBlock, devices, lifecycle } = build({ customerId: '99' });
    await expect(service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136', blockCaller: false })).rejects.toThrow(
      'ONBOARDING_IP_BLOCKED',
    );
    expect(ipBlock.block).not.toHaveBeenCalled();
    expect(devices.fingerprintsOfCustomer).not.toHaveBeenCalled();
    expect(lifecycle.advance).not.toHaveBeenCalled();
  });

  it('si falla un bloqueo, los otros se aplican igual y el alta se corta igual', async () => {
    const { service, ipBlock, devices, lifecycle } = build({ customerId: '99' });
    devices.fingerprintsOfCustomer.mockRejectedValueOnce(new Error('base caída') as never);
    await expect(service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' })).rejects.toThrow(
      'ONBOARDING_IP_BLOCKED',
    );
    expect(ipBlock.block).toHaveBeenCalled();
    expect(lifecycle.advance).toHaveBeenCalled();
    lifecycle.advance.mockRejectedValueOnce(new Error('transición') as never);
    await expect(service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' })).rejects.toThrow(
      'ONBOARDING_IP_BLOCKED',
    );
  });

  it('calcula el hash en el servidor con el mismo criterio que la app (recortado y en minúsculas)', async () => {
    const { service, evidenceRepository } = build(null);
    await service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '  8452136A ' });
    expect(evidenceRepository.findIdentityDocumentOfAnotherCustomer).toHaveBeenCalledWith('t1', '10', [hashSensitiveText('8452136a')]);
  });

  it('busca también por el hash que declara el teléfono, y excluye siempre al propio cliente', async () => {
    const { service, evidenceRepository } = build(null);
    await service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '123', documentNumberHash: 'ABC' });
    const [, customerId, hashes] = evidenceRepository.findIdentityDocumentOfAnotherCustomer.mock.calls[0] as [string, string, string[]];
    expect(customerId).toBe('10');
    expect(hashes).toEqual(expect.arrayContaining([hashSensitiveText('123'), 'abc']));
  });

  it('sin número ni hash no consulta nada', async () => {
    const { service, evidenceRepository } = build({ customerId: '99' });
    await service.assertNotRegisteredToAnotherCustomer(base);
    expect(evidenceRepository.findIdentityDocumentOfAnotherCustomer).not.toHaveBeenCalled();
  });
});
