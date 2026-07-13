import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { CustomersRepository } from '../../../src/modules/customers/customers.repository.js';

/**
 * `listActiveCustomerIds` es lo que resuelve el destinatario "todos los customers" de un
 * broadcast de admin. El punto delicado: `lifecycleStatus` es nullable en el modelo — un filtro
 * ingenuo `{ [Op.ne]: 'blocked' }` excluiría también (incorrectamente) a los clientes sin el
 * campo seteado, porque en SQL `NULL != 'blocked'` no es `true`. Este test fija que el `OR`
 * explícito con NULL está presente.
 */
describe('CustomersRepository.listActiveCustomerIds', () => {
  it('queries with tenantId, excludes deleted, and includes an explicit OR for NULL lifecycleStatus', async () => {
    const customerModel = { findAll: jest.fn(async () => [{ id: '1' }, { id: '2' }]) };
    const repository = new CustomersRepository(customerModel as never, {} as never, {} as never, {} as never, {} as never, {} as never);

    const ids = await repository.listActiveCustomerIds('t1');

    expect(ids).toEqual(['1', '2']);
    const callArgs = (customerModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).toMatchObject({ tenantId: 't1', deleted: { [Op.ne]: true } });
    expect(callArgs.where[Op.or]).toEqual([{ lifecycleStatus: null }, { lifecycleStatus: { [Op.ne]: 'blocked' } }]);
  });

  it('returns string ids even when the model returns numeric-like values', async () => {
    const customerModel = { findAll: jest.fn(async () => [{ id: 42 }]) };
    const repository = new CustomersRepository(customerModel as never, {} as never, {} as never, {} as never, {} as never, {} as never);

    const ids = await repository.listActiveCustomerIds('t1');

    expect(ids).toEqual(['42']);
  });
});
