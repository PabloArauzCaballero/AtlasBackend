import { describe, expect, it, jest } from '@jest/globals';
import { PendingContactVerificationService } from '../../../src/modules/operations/pending-contact-verification.service.js';

describe('PendingContactVerificationService', () => {
  it('cruza cada contacto sin verificar con su cliente y descarta los huérfanos', async () => {
    const creado = new Date('2026-09-14T10:00:00Z');
    const customersRepository = {
      findManyByIds: jest.fn(async (..._args: unknown[]) => [
        { id: '21', customerCode: 'CUS-21', lifecycleStatus: 'under_review', createdAtValue: creado },
      ]),
    };
    const contactsRepository = {
      listUnverified: jest.fn(async (..._args: unknown[]) => [
        {
          id: '501',
          customerId: '21',
          contactType: 'email',
          valueLast4: 'l.bo',
          emailDomain: 'upsa.edu.bo',
          isPrimary: true,
          createdAtValue: creado,
        },
        {
          id: '502',
          customerId: '99',
          contactType: 'phone',
          valueLast4: '1234',
          emailDomain: null,
          isPrimary: true,
          createdAtValue: creado,
        },
      ]),
    };
    const service = new PendingContactVerificationService(customersRepository as never, contactsRepository as never);

    const result = await service.list('1');

    expect(customersRepository.findManyByIds).toHaveBeenCalledWith('1', ['21', '99']);
    expect(result.items).toEqual([
      {
        customerId: '21',
        customerCode: 'CUS-21',
        lifecycleStatus: 'under_review',
        customerCreatedAt: creado.toISOString(),
        contactMethodId: '501',
        contactType: 'email',
        valueLast4: 'l.bo',
        emailDomain: 'upsa.edu.bo',
        isPrimary: true,
        contactCreatedAt: creado.toISOString(),
      },
    ]);
  });
});
