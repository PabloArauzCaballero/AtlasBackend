import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { IdentityDocumentDuplicateService } from '../../../src/modules/customer-onboarding/application/identity-document-duplicate.service.js';
import { ONBOARDING_STRIKE_LIMIT } from '../../../src/modules/customer-onboarding/application/onboarding-strike.service.js';
import { hashSensitiveText } from '../../../src/common/utils/crypto/hash.util.js';

/**
 * Carnet ya registrado en otra cuenta: la primera vez se avisa con 409 sin bloquear; al reincidir con carnets
 * DISTINTOS se bloquean la IP, el dispositivo y la cuenta (Pablo, 2026-10-19).
 */
describe('IdentityDocumentDuplicateService', () => {
  function build(found: { customerId: string } | null, fingerprints: string[] = ['fp-1'], strikeCount = 1) {
    const evidenceRepository = { findIdentityDocumentOfAnotherCustomer: jest.fn(async (..._a: unknown[]) => found) };
    const ipBlock = {
      block: jest.fn(async (..._a: unknown[]) => undefined),
      blockDevice: jest.fn(async (..._a: unknown[]) => undefined),
    };
    const strikes = { record: jest.fn(async (..._a: unknown[]) => strikeCount) };
    const devices = { fingerprintsOfCustomer: jest.fn(async (..._a: unknown[]) => fingerprints) };
    const lifecycle = { advance: jest.fn(async (..._a: unknown[]) => null) };
    const sequelize = { transaction: jest.fn(async (callback: (t: unknown) => Promise<unknown>) => callback({ id: 'tx' })) };
    const service = new IdentityDocumentDuplicateService(
      evidenceRepository as never,
      ipBlock as never,
      strikes as never,
      devices as never,
      lifecycle as never,
      sequelize as never,
    );
    return { service, evidenceRepository, ipBlock, strikes, devices, lifecycle, sequelize };
  }
  const base = { tenantId: 't1', customerId: '10', ipAddress: '200.1.2.3', blockCaller: true };

  it('deja pasar un carnet que no figura en otra cuenta y no anota nada', async () => {
    const { service, ipBlock, strikes, lifecycle } = build(null);
    await expect(service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' })).resolves.toBeUndefined();
    expect(strikes.record).not.toHaveBeenCalled();
    expect(ipBlock.block).not.toHaveBeenCalled();
    expect(lifecycle.advance).not.toHaveBeenCalled();
  });

  it('la primera vez que el carnet ya existe avisa con 409 y NO bloquea nada', async () => {
    const { service, ipBlock, lifecycle } = build({ customerId: '99' }, ['fp-1'], 1);
    const result = service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' });
    await expect(result).rejects.toThrow(ConflictException);
    await expect(result).rejects.toThrow('IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(ipBlock.block).not.toHaveBeenCalled();
    expect(ipBlock.blockDevice).not.toHaveBeenCalled();
    expect(lifecycle.advance).not.toHaveBeenCalled();
  });

  it('anota el intento contra la IP, la cuenta y cada dispositivo, con el hash del carnet', async () => {
    const { service, strikes } = build({ customerId: '99' }, ['fp-1', 'fp-2'], 2);
    await expect(service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' })).rejects.toThrow(ConflictException);
    expect(strikes.record).toHaveBeenCalledWith(
      ['ip:200.1.2.3', 'customer:10', 'device:fp-1', 'device:fp-2'],
      hashSensitiveText('8452136'),
    );
  });

  it('al llegar al límite bloquea IP, dispositivo y cuenta y responde 403 ONBOARDING_IP_BLOCKED', async () => {
    const { service, ipBlock, lifecycle } = build({ customerId: '99' }, ['fp-1', 'fp-2'], ONBOARDING_STRIKE_LIMIT);
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

  it('personal interno que envía por un cliente: se rechaza con 409 pero no se anota ni se bloquea nada', async () => {
    const { service, strikes, ipBlock, devices, lifecycle } = build({ customerId: '99' }, ['fp-1'], ONBOARDING_STRIKE_LIMIT);
    await expect(service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136', blockCaller: false })).rejects.toThrow(
      ConflictException,
    );
    expect(strikes.record).not.toHaveBeenCalled();
    expect(ipBlock.block).not.toHaveBeenCalled();
    expect(devices.fingerprintsOfCustomer).not.toHaveBeenCalled();
    expect(lifecycle.advance).not.toHaveBeenCalled();
  });

  it('si falla leer los dispositivos o bloquear la cuenta, el 403 sale igual y lo demás se aplica', async () => {
    const { service, ipBlock, devices, lifecycle } = build({ customerId: '99' }, ['fp-1'], ONBOARDING_STRIKE_LIMIT);
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
