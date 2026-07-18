import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { CustomersRepository } from '../../../src/modules/customers/customers.repository.js';

/**
 * Cobertura directa de `CustomersRepository` (Fase 1.2 del plan 10/10): lectura del cliente y sus
 * agregados (perfil, contacto, consentimientos, riesgo) y altas con defaults. Incluye ramas no
 * triviales: `listActiveCustomerIds` (OR con NULL para no excluir lifecycleStatus nulo),
 * `findByContactHash` (phone/email/ninguno) y el label por tipo de contacto. Modelos mockeados.
 */
describe('CustomersRepository', () => {
  function buildRepo() {
    const customerModel = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() };
    const profileModel = { create: jest.fn(), findOne: jest.fn() };
    const contactMethodModel = { create: jest.fn(), findAll: jest.fn() };
    const statusEventModel = { create: jest.fn() };
    const customerConsentModel = { findAll: jest.fn() };
    const riskResultModel = { findOne: jest.fn() };
    const repo = new CustomersRepository(
      customerModel as never,
      profileModel as never,
      contactMethodModel as never,
      statusEventModel as never,
      customerConsentModel as never,
      riskResultModel as never,
    );
    return { repo, customerModel, profileModel, contactMethodModel, statusEventModel, customerConsentModel, riskResultModel };
  }

  const opts = { transaction: 'tx' as never };
  const now = new Date('2026-01-20');

  it('findById excluye borrados y filtra por id+tenant', async () => {
    const { repo, customerModel } = buildRepo();
    (customerModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findById('t1', 'c1', opts);
    const where = (customerModel.findOne as jest.Mock).mock.calls[0][0].where as Record<string, unknown>;
    expect(where).toMatchObject({ id: 'c1', tenantId: 't1' });
    expect(where.deleted).toBeDefined();
  });

  it('listActiveCustomerIds usa OR (lifecycleStatus null | != blocked) y mapea ids a string', async () => {
    const { repo, customerModel } = buildRepo();
    (customerModel.findAll as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    const result = await repo.listActiveCustomerIds('t1');
    expect(result).toEqual(['1', '2']);
    const where = (customerModel.findAll as jest.Mock).mock.calls[0][0].where as Record<symbol, unknown>;
    const or = where[Op.or] as Array<Record<string, unknown>>;
    expect(or[0]).toEqual({ lifecycleStatus: null });
    expect((or[1].lifecycleStatus as Record<symbol, unknown>)[Op.ne]).toBe('blocked');
  });

  it('findByContactHash con ninguna hash devuelve null sin consultar', async () => {
    const { repo, customerModel } = buildRepo();
    const result = await repo.findByContactHash('t1', {});
    expect(result).toBeNull();
    expect(customerModel.findOne).not.toHaveBeenCalled();
  });

  it('findByContactHash con phone y email arma un OR con ambas condiciones', async () => {
    const { repo, customerModel } = buildRepo();
    (customerModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findByContactHash('t1', { phoneHash: 'ph', emailHash: 'eh' });
    const or = (customerModel.findOne as jest.Mock).mock.calls[0][0].where[Op.or] as Array<Record<string, unknown>>;
    expect(or).toEqual([{ primaryPhoneHash: 'ph' }, { primaryEmailHash: 'eh' }]);
  });

  it('createCustomer nace no borrado, sin perfil actual y con timestamps de createdAt', async () => {
    const { repo, customerModel } = buildRepo();
    (customerModel.create as jest.Mock).mockResolvedValue({ id: 'c1' } as never);
    await repo.createCustomer(
      {
        tenantId: 't1',
        customerCode: 'C-1',
        customerUuid: 'uuid',
        primaryPhoneHash: null,
        primaryPhoneLast4: null,
        primaryEmailHash: null,
        primaryEmailDomain: null,
        lifecycleStatus: 'active',
        createdAt: now,
      },
      opts,
    );
    expect((customerModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      deleted: false,
      currentProfileVersionId: null,
      closedAt: null,
      createdAtValue: now,
      updatedAtValue: now,
    });
  });

  it('createProfileVersion nace vigente (validUntil null) con validFrom=createdAt', async () => {
    const { repo, profileModel } = buildRepo();
    (profileModel.create as jest.Mock).mockResolvedValue({ id: 'p1' } as never);
    await repo.createProfileVersion(
      {
        tenantId: 't1',
        customerId: 'c1',
        firstName: 'A',
        lastName: 'B',
        fullNameNormalized: 'a b',
        birthDate: null,
        preferredLanguage: 'es',
        marketingOptIn: false,
        sourceType: 'api',
        createdAt: now,
      },
      opts,
    );
    expect((profileModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ validFrom: now, validUntil: null, supersedesVersionId: null });
  });

  it('updateCurrentProfileVersion fija currentProfileVersionId y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({}));
    const customer = { save } as never;
    await repo.updateCurrentProfileVersion(customer, 'p9', now, opts);
    expect((customer as { currentProfileVersionId: string }).currentProfileVersionId).toBe('p9');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('createStatusEvent mapea happenedAt a createdAtValue', async () => {
    const { repo, statusEventModel } = buildRepo();
    (statusEventModel.create as jest.Mock).mockResolvedValue({ id: 's1' } as never);
    await repo.createStatusEvent(
      { tenantId: 't1', customerId: 'c1', previousStatus: null, newStatus: 'active', reasonCode: 'ok', changedByType: 'system', happenedAt: now, notes: null },
      opts,
    );
    expect((statusEventModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ createdAtValue: now, newStatus: 'active' });
  });

  it('createContactMethod usa label primary_phone para phone', async () => {
    const { repo, contactMethodModel } = buildRepo();
    (contactMethodModel.create as jest.Mock).mockResolvedValue({ id: 'cm1' } as never);
    await repo.createContactMethod(
      { tenantId: 't1', customerId: 'c1', contactType: 'phone', contactValueHash: 'h', contactValueEncrypted: null, valueLast4: '1234', emailDomain: null, isPrimary: true, sourceType: 'api', createdAt: now },
      opts,
    );
    expect((contactMethodModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ label: 'primary_phone', status: 'unverified', deleted: false });
  });

  it('createContactMethod usa label primary_email para email', async () => {
    const { repo, contactMethodModel } = buildRepo();
    (contactMethodModel.create as jest.Mock).mockResolvedValue({ id: 'cm1' } as never);
    await repo.createContactMethod(
      { tenantId: 't1', customerId: 'c1', contactType: 'email', contactValueHash: 'h', contactValueEncrypted: null, valueLast4: null, emailDomain: 'x.com', isPrimary: true, sourceType: 'api', createdAt: now },
      opts,
    );
    expect((contactMethodModel.create as jest.Mock).mock.calls[0][0].label).toBe('primary_email');
  });

  it('findCurrentProfile filtra validUntil null y ordena por validFrom desc', async () => {
    const { repo, profileModel } = buildRepo();
    (profileModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findCurrentProfile('t1', 'c1');
    const arg = (profileModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toMatchObject({ validUntil: null });
    expect(arg.order).toEqual([
      ['validFrom', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('findContactMethods excluye borrados', async () => {
    const { repo, contactMethodModel } = buildRepo();
    (contactMethodModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findContactMethods('t1', 'c1');
    expect((contactMethodModel.findAll as jest.Mock).mock.calls[0][0].where.deleted).toBeDefined();
  });

  it('findLatestRiskResult ordena por decidedAt desc', async () => {
    const { repo, riskResultModel } = buildRepo();
    (riskResultModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findLatestRiskResult('t1', 'c1');
    expect((riskResultModel.findOne as jest.Mock).mock.calls[0][0].order).toEqual([
      ['decidedAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });
});
