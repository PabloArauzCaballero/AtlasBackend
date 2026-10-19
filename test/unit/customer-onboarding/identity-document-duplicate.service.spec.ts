import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { IdentityDocumentDuplicateService } from '../../../src/modules/customer-onboarding/application/identity-document-duplicate.service.js';
import { hashSensitiveText } from '../../../src/common/utils/crypto/hash.util.js';

/**
 * Carnet repetido en otra cuenta ⇒ la IP se bloquea y el alta se corta. Es la defensa contra
 * suplantación de identidad pedida por Pablo (2026-10-19).
 */
describe('IdentityDocumentDuplicateService', () => {
  function build(found: { customerId: string } | null) {
    const evidenceRepository = { findIdentityDocumentOfAnotherCustomer: jest.fn(async (..._a: unknown[]) => found) };
    const ipBlock = { block: jest.fn(async (..._a: unknown[]) => undefined) };
    const service = new IdentityDocumentDuplicateService(evidenceRepository as never, ipBlock as never);
    return { service, evidenceRepository, ipBlock };
  }
  const base = { tenantId: 't1', customerId: '10', ipAddress: '200.1.2.3' };

  it('deja pasar un carnet que no figura en otra cuenta y no bloquea nada', async () => {
    const { service, ipBlock } = build(null);
    await expect(service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' })).resolves.toBeUndefined();
    expect(ipBlock.block).not.toHaveBeenCalled();
  });

  it('si el carnet ya es de otro cliente, bloquea la IP y responde ONBOARDING_IP_BLOCKED sin confirmar que existe', async () => {
    const { service, ipBlock } = build({ customerId: '99' });
    const result = service.assertNotRegisteredToAnotherCustomer({ ...base, documentNumber: '8452136' });
    await expect(result).rejects.toThrow(ForbiddenException);
    await expect(result).rejects.toThrow('ONBOARDING_IP_BLOCKED');
    expect(ipBlock.block).toHaveBeenCalledWith('200.1.2.3', 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
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
