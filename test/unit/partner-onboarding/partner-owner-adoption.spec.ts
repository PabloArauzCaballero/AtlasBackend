import { describe, expect, it, jest } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { adoptPartnerOwnerForAccount } from '../../../src/database/partner-owner-adoption.js';

/**
 * El ERP abre el expediente SIN dueño y `/partner-onboarding/mine` busca sólo por dueño: sin esta
 * sentencia el comercio entraba y «Mi empresa» le pedía abrir un expediente desde cero.
 */
describe('adoptPartnerOwnerForAccount', () => {
  it('sólo toca expedientes SIN dueño, de esa cuenta y tenant, con la primera persona concedida', async () => {
    const query = jest.fn(async (..._args: unknown[]) => [[], 2]);

    const filas = await adoptPartnerOwnerForAccount({ query } as never, { tenantId: 't1', erpAccountId: 'cuenta-9' });

    expect(filas).toBe(2);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('p.owner_merchant_user_id IS NULL');
    expect(sql).toContain("status = 'provisioned'");
    expect(sql).toContain('ORDER BY decided_at ASC');
    expect(sql).toContain('LIMIT 1');
    expect(query.mock.calls[0]?.[1]).toMatchObject({
      replacements: { tenantId: 't1', erpAccountId: 'cuenta-9' },
      type: QueryTypes.UPDATE,
    });
  });

  it('usa la transacción que le pasan, para que conceder y quedar como dueño sean un solo hecho', async () => {
    const query = jest.fn(async (..._args: unknown[]) => [[], 0]);
    const transaction = { id: 'trx' };

    await adoptPartnerOwnerForAccount({ query } as never, { tenantId: 't1', erpAccountId: 'c' }, transaction as never);

    expect((query.mock.calls[0]?.[1] as { transaction: unknown }).transaction).toBe(transaction);
  });
});
