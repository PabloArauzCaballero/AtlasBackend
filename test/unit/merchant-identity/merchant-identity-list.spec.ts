import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { MerchantUsersService } from '../../../src/modules/merchant-identity/merchant-users.service.js';
import { merchantListConditions, merchantListPage } from '../../../src/modules/merchant-identity/merchant-identity-list.filter.js';

describe('Identidades de comercio: búsqueda, página y motivo auditado', () => {
  it('q busca por partes en las columnas pedidas; email sigue siendo exacto', () => {
    const condiciones = merchantListConditions([{ tenantId: 't1' }], { page: 1, limit: 25, q: 'ana_', email: 'X@Y.test' }, [
      'email',
      'fullName',
    ]);
    expect(condiciones).toContainEqual({ [Op.or]: [{ email: { [Op.iLike]: '%ana\\_%' } }, { fullName: { [Op.iLike]: '%ana\\_%' } }] });
    expect(JSON.stringify(condiciones[1])).toContain('x@y.test');
  });

  it('sin q no hay búsqueda por partes', () => {
    expect(merchantListConditions([{ tenantId: 't1' }], { page: 1, limit: 25, status: 'active' }, ['email'])).toEqual([
      { tenantId: 't1' },
      { status: 'active' },
    ]);
  });

  it('la página conserva page/limit/total y añade el meta canónico', () => {
    expect(merchantListPage(['a'], { page: 2, limit: 10 }, 21)).toEqual({
      items: ['a'],
      page: 2,
      limit: 10,
      total: 21,
      meta: { page: 2, limit: 10, total: 21, totalPages: 3 },
    });
  });

  it('cambiar el estado deja el motivo, el estado anterior y el nuevo en la auditoría, en la misma transacción', async () => {
    const usuario = { id: 'm1', status: 'active', update: jest.fn(async (..._args: unknown[]) => undefined) };
    const auditCreate = jest.fn(async (..._args: unknown[]) => ({}));
    const sequelize = { transaction: jest.fn(async (work: (t: unknown) => unknown) => work('tx')) };
    const service = new MerchantUsersService(
      { findOne: jest.fn(async () => usuario) } as never,
      {} as never,
      {} as never,
      sequelize as never,
      { create: auditCreate } as never,
    );
    await service.updateStatus('t1', 'm1', { status: 'suspended', reason: 'Salió del comercio' }, { internalUserId: '9' });
    expect(usuario.update.mock.calls[0]?.[1]).toEqual({ transaction: 'tx' });
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({
      tenantId: 't1',
      actorInternalUserId: '9',
      actionCode: 'merchant_users.status_change',
      targetType: 'merchant_user',
      targetId: 'm1',
      payloadJson: { previousStatus: 'active', newStatus: 'suspended', reason: 'Salió del comercio' },
    });
    expect(auditCreate.mock.calls[0]?.[1]).toEqual({ transaction: 'tx' });
  });
});
