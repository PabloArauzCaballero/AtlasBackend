/**
 * @file Verifica los límites de persistencia del dominio de crédito.
 * @business Protege catálogo, solicitud e historial contra cruces de tenant y estados incompletos.
 * @system Fija filtros, orden, transacciones y mutaciones de CreditRepository.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CreditRepository } from '../../../src/modules/credit/credit.repository.js';

describe('CreditRepository', () => {
  it('aplica filtros de tenant y delega todas las lecturas/escrituras con su transacción', async () => {
    const product = {
      id: '21',
      status: 'draft',
      updatedAtValue: null,
      save: jest.fn(async function (this: unknown) {
        return this;
      }),
    };
    const application = {
      id: '31',
      status: 'submitted',
      decisionReasonCode: null,
      decidedByInternalUserId: null,
      decidedAt: null,
      updatedAtValue: null,
      save: jest.fn(async function (this: unknown) {
        return this;
      }),
    };
    const event = { id: '41' };
    const productModel = {
      findAll: jest.fn(async () => [product]),
      findOne: jest.fn(async () => product),
      create: jest.fn(async () => product),
    };
    const applicationModel = {
      findOne: jest.fn(async () => application),
      findAll: jest.fn(async () => [application]),
      create: jest.fn(async () => application),
    };
    const eventModel = {
      create: jest.fn(async () => event),
      findAll: jest.fn(async () => [event]),
    };
    const repository = new CreditRepository(productModel as never, applicationModel as never, eventModel as never);
    const transaction = { id: 'tx-1' } as never;
    const now = new Date('2026-07-28T12:00:00.000Z');

    await expect(repository.findOfferableProducts('7', now)).resolves.toEqual([product]);
    await expect(repository.findProductById('7', '21', { transaction })).resolves.toBe(product);
    await expect(repository.findProductById('7', '21')).resolves.toBe(product);
    await expect(repository.findProductByCode('7', 'consumo_12')).resolves.toBe(product);
    await expect(repository.createProduct({ productCode: 'micro_6' }, { transaction })).resolves.toBe(product);
    await expect(repository.createProduct({ productCode: 'micro_6' })).resolves.toBe(product);
    await expect(repository.updateProductStatus(product as never, 'active', now)).resolves.toBe(product);
    expect(product).toMatchObject({ status: 'active', updatedAtValue: now });

    await expect(repository.findOpenApplication('7', '10', { transaction })).resolves.toBe(application);
    await expect(repository.findOpenApplication('7', '10')).resolves.toBe(application);
    await expect(repository.findApplicationById('7', '31', { transaction })).resolves.toBe(application);
    await expect(repository.findApplicationById('7', '31')).resolves.toBe(application);
    await expect(repository.findApplicationsByCustomer('7', '10')).resolves.toEqual([application]);
    await expect(repository.createApplication({ customerId: '10' }, { transaction })).resolves.toBe(application);
    await expect(
      repository.updateApplicationStatus(
        application as never,
        { status: 'approved', reasonCode: 'manual_ok', decidedByInternalUserId: '3', now },
        { transaction },
      ),
    ).resolves.toBe(application);
    expect(application).toMatchObject({
      status: 'approved',
      decisionReasonCode: 'manual_ok',
      decidedByInternalUserId: '3',
      decidedAt: now,
      updatedAtValue: now,
    });

    const eventValues = {
      tenantId: '7',
      creditApplicationId: '31',
      eventType: 'decision_recorded',
      previousStatus: 'submitted',
      newStatus: 'approved',
      actorType: 'admin',
      actorInternalUserId: '3',
      reasonCode: 'manual_ok',
      payloadJson: { decision: 'approve' },
      notes: null,
      happenedAt: now,
    };
    await expect(repository.createApplicationEvent(eventValues, { transaction })).resolves.toBe(event);
    await expect(repository.findApplicationEvents('7', '31')).resolves.toEqual([event]);
    expect(eventModel.create).toHaveBeenCalledWith({ ...eventValues, createdAtValue: now }, { transaction });
    expect(eventModel.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });
});
