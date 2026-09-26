/**
 * @file Verifica los límites de persistencia del dominio de crédito.
 * @business Protege catálogo, solicitud e historial contra cruces de tenant y estados incompletos.
 * @system Fija filtros, orden, transacciones y mutaciones de CreditRepository.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
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
      findAll: jest.fn(async (..._args: unknown[]) => [product]),
      findOne: jest.fn(async (..._args: unknown[]) => product),
      create: jest.fn(async (..._args: unknown[]) => product),
    };
    const applicationModel = {
      findOne: jest.fn(async (..._args: unknown[]) => application),
      findAll: jest.fn(async (..._args: unknown[]) => [application]),
      create: jest.fn(async (..._args: unknown[]) => application),
    };
    const eventModel = {
      create: jest.fn(async (..._args: unknown[]) => event),
      findAll: jest.fn(async (..._args: unknown[]) => [event]),
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

  describe('C-2 y C-3', () => {
    function build() {
      const application = {
        status: 'under_review',
        decisionMode: null as string | null,
        decisionReasonCode: null,
        decidedByInternalUserId: null,
        decidedAt: null,
        updatedAtValue: null,
        save: jest.fn(async function (this: unknown) {
          return this;
        }),
      };
      const applicationModel = { findAll: jest.fn(async (..._args: unknown[]) => [application]) };
      const repository = new CreditRepository({} as never, applicationModel as never, {} as never);
      return { repository, application, applicationModel };
    }

    it('findStaleSubmittedApplications pide sólo las submitted del tenant más viejas que el corte, las más antiguas primero', async () => {
      const { repository, application, applicationModel } = build();
      const olderThan = new Date('2026-09-25T11:45:00.000Z');

      await expect(repository.findStaleSubmittedApplications('7', olderThan, 20)).resolves.toEqual([application]);

      // El corte va en la consulta, no después en memoria: una recién creada no puede ni traerse.
      expect(applicationModel.findAll).toHaveBeenCalledWith({
        where: { tenantId: '7', deleted: false, status: 'submitted', submittedAt: { [Op.lt]: olderThan } },
        order: [['submittedAt', 'ASC']],
        limit: 20,
      });
    });

    it('updateApplicationStatus escribe el modo de decisión cuando quien llama lo sabe (C-3)', async () => {
      const { repository, application } = build();

      await repository.updateApplicationStatus(
        application as never,
        { status: 'approved', reasonCode: 'ok', decidedByInternalUserId: '3', now: new Date(), decisionMode: 'manual' },
        {},
      );

      expect(application.decisionMode).toBe('manual');
    });

    it('sin decisionMode conserva el que la fila tuviera: no lo pisa con NULL', async () => {
      const { repository, application } = build();
      application.decisionMode = 'decision_engine';

      await repository.updateApplicationStatus(
        application as never,
        { status: 'approved', reasonCode: 'ok', decidedByInternalUserId: '3', now: new Date() },
        {},
      );

      expect(application.decisionMode).toBe('decision_engine');
    });
  });
});
