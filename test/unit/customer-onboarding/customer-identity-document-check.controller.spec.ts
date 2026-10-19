import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { CustomerIdentityDocumentCheckController } from '../../../src/modules/customer-onboarding/customer-identity-document-check.controller.js';

describe('CustomerIdentityDocumentCheckController', () => {
  const dueño = { role: 'customer', customerId: '10' } as never;

  function build() {
    const duplicateService = { assertNotRegisteredToAnotherCustomer: jest.fn(async (..._a: unknown[]) => undefined) };
    return { controller: new CustomerIdentityDocumentCheckController(duplicateService as never), duplicateService };
  }

  it('responde available cuando el carnet no figura en otra cuenta, con la IP de la petición', async () => {
    const { controller, duplicateService } = build();
    const result = await controller.check('t1', { customerId: '10' }, { documentNumber: '8452136' }, dueño, { ip: '200.1.2.3' } as never);
    expect(result).toEqual({ available: true });
    expect(duplicateService.assertNotRegisteredToAnotherCustomer).toHaveBeenCalledWith({
      tenantId: 't1',
      customerId: '10',
      documentNumber: '8452136',
      ipAddress: '200.1.2.3',
      blockCaller: true,
    });
  });

  it('propaga el bloqueo cuando el carnet es de otra cuenta', async () => {
    const { controller, duplicateService } = build();
    duplicateService.assertNotRegisteredToAnotherCustomer.mockRejectedValueOnce(new ForbiddenException('ONBOARDING_IP_BLOCKED') as never);
    await expect(
      controller.check('t1', { customerId: '10' }, { documentNumber: '8452136' }, dueño, { ip: '200.1.2.3' } as never),
    ).rejects.toThrow('ONBOARDING_IP_BLOCKED');
  });

  it('un cliente no puede comprobar carnets a nombre de otro cliente', async () => {
    const { controller, duplicateService } = build();
    await expect(
      controller.check('t1', { customerId: '99' }, { documentNumber: '8452136' }, dueño, { ip: '1.1.1.1' } as never),
    ).rejects.toThrow(ForbiddenException);
    expect(duplicateService.assertNotRegisteredToAnotherCustomer).not.toHaveBeenCalled();
  });
});
