/**
 * @file Verifica catálogo y decisiones del dominio de crédito.
 * @business Protege que la oferta comercial y las decisiones humanas sean coherentes, trazables y no repetibles.
 * @system Fija mapeos, errores y atomicidad de CreditProductService y CreditDecisionService.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CreditDecisionService } from '../../../src/modules/credit/application/credit-decision.service.js';
import { CreditProductService } from '../../../src/modules/credit/application/credit-product.service.js';

const customerUser = { sub: 'customer-10', tenantId: '7', customerId: '10', role: 'customer' } as never;
const operatorUser = { sub: 'operator-3', tenantId: '7', internalUserId: '3', role: 'admin' } as never;

function buildProductService() {
  const product = {
    id: '21',
    productCode: 'consumo_12',
    productName: 'Consumo 12 meses',
    description: 'Producto de prueba',
    currencyCode: 'BOB',
    minAmount: '500.00',
    maxAmount: '5000.00',
    minTermMonths: 3,
    maxTermMonths: 12,
    annualInterestRate: '18.5000',
    requiresManualReview: false,
    minMonthlyIncome: null,
    status: 'active',
  };
  const creditRepository = {
    findOfferableProducts: jest.fn(async (..._args: unknown[]) => [product]),
    findProductByCode: jest.fn(async (..._args: unknown[]) => null),
    createProduct: jest.fn(async (values: Record<string, unknown>) => ({ id: '22', ...values })),
    findProductById: jest.fn(async (..._args: unknown[]) => product),
    updateProductStatus: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const eligibilityService = {
    evaluate: jest.fn(async (..._args: unknown[]) => ({ eligible: true, blockers: [] })),
  };
  // Los valores económicos alimentan la elegibilidad POR PRODUCTO: un cliente habilitado puede no
  // alcanzar el ingreso mínimo de un producto y sí el de otro.
  const eligibilityRepository = {
    loadFacts: jest.fn(async (..._args: unknown[]) => ({ financialAttributeValues: { monthly_income_declared: 6000 } })),
  };
  return {
    product,
    creditRepository,
    eligibilityService,
    eligibilityRepository,
    service: new CreditProductService(creditRepository as never, eligibilityService as never, eligibilityRepository as never),
  };
}

describe('CreditProductService', () => {
  it('une catálogo y elegibilidad sin delegar la decisión al frontend', async () => {
    const { service, creditRepository, eligibilityService } = buildProductService();

    const result = await service.listForCustomer({ tenantId: '7', customerId: '10', currentUser: customerUser });

    expect(result).toMatchObject({
      customerId: '10',
      eligible: true,
      products: [{ productId: '21', productCode: 'consumo_12', canApply: true }],
    });
    expect(creditRepository.findOfferableProducts).toHaveBeenCalledWith('7', expect.any(Date));
    expect(eligibilityService.evaluate).toHaveBeenCalledWith('7', '10');
  });

  it('canApply es false para un producto cuyo ingreso mínimo el cliente no alcanza, aunque esté habilitado', async () => {
    const { service, creditRepository, product } = buildProductService();
    (creditRepository.findOfferableProducts as jest.Mock).mockResolvedValueOnce([{ ...product, minMonthlyIncome: '12000.00' }] as never);

    const result = await service.listForCustomer({ tenantId: '7', customerId: '10', currentUser: customerUser });

    expect(result.eligible).toBe(true);
    expect(result.products[0].canApply).toBe(false);
  });

  it('impide que un cliente consulte el catálogo contextualizado de otro cliente', async () => {
    const { service } = buildProductService();
    await expect(service.listForCustomer({ tenantId: '7', customerId: '99', currentUser: customerUser })).rejects.toThrow();
  });

  it('lista para operaciones usando el catálogo vigente del tenant', async () => {
    const { service, product } = buildProductService();
    await expect(service.listForOperations('7')).resolves.toEqual({ products: [product] });
  });

  it('rechaza códigos duplicados antes de crear el producto', async () => {
    const { service, creditRepository } = buildProductService();
    (creditRepository.findProductByCode as jest.Mock).mockResolvedValueOnce({ id: 'existing' } as never);

    await expect(
      service.createProduct({
        tenantId: '7',
        currentUser: operatorUser,
        body: {
          productCode: 'consumo_12',
          productName: 'Consumo 12 meses',
          currencyCode: 'BOB',
          minAmount: 500,
          maxAmount: 5000,
          minTermMonths: 3,
          maxTermMonths: 12,
          requiresManualReview: false,
        },
      }),
    ).rejects.toThrow(ConflictException);
    expect(creditRepository.createProduct).not.toHaveBeenCalled();
  });

  it('crea en draft y normaliza importes, tasas, vigencia y actor', async () => {
    const { service, creditRepository } = buildProductService();
    const result = await service.createProduct({
      tenantId: '7',
      currentUser: operatorUser,
      body: {
        productCode: 'micro_6',
        productName: 'Microcrédito seis meses',
        description: 'Capital de trabajo',
        currencyCode: 'BOB',
        minAmount: 1000,
        maxAmount: 9000.5,
        minTermMonths: 3,
        maxTermMonths: 6,
        annualInterestRate: 12.5,
        minMonthlyIncome: 2500,
        requiresManualReview: true,
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        effectiveUntil: '2027-08-01T00:00:00.000Z',
      },
    });

    expect(creditRepository.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        minAmount: '1000.00',
        maxAmount: '9000.50',
        annualInterestRate: '12.5000',
        minMonthlyIncome: '2500.00',
        createdByInternalUserId: '3',
        effectiveFrom: expect.any(Date),
        effectiveUntil: expect.any(Date),
      }),
    );
    expect(result).toMatchObject({ productId: '22', productCode: 'micro_6', status: 'draft' });
  });

  it('normaliza como null las condiciones comerciales opcionales ausentes', async () => {
    const { service, creditRepository } = buildProductService();
    await service.createProduct({
      tenantId: '7',
      currentUser: { sub: 'system', role: 'system' } as never,
      body: {
        productCode: 'simple_3',
        productName: 'Crédito simple',
        currencyCode: 'BOB',
        minAmount: 100,
        maxAmount: 500,
        minTermMonths: 1,
        maxTermMonths: 3,
        requiresManualReview: false,
      },
    });

    expect(creditRepository.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        description: null,
        annualInterestRate: null,
        minMonthlyIncome: null,
        effectiveFrom: null,
        effectiveUntil: null,
        createdByInternalUserId: null,
      }),
    );
  });

  it('cambia estado conservando el estado anterior y falla si no existe', async () => {
    const found = buildProductService();
    await expect(
      found.service.changeStatus({ tenantId: '7', productId: '21', status: 'suspended', currentUser: operatorUser }),
    ).resolves.toEqual({ productId: '21', previousStatus: 'active', status: 'suspended' });
    expect(found.creditRepository.updateProductStatus).toHaveBeenCalledWith(found.product, 'suspended', expect.any(Date));

    const missing = buildProductService();
    (missing.creditRepository.findProductById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(
      missing.service.changeStatus({ tenantId: '7', productId: '404', status: 'retired', currentUser: operatorUser }),
    ).rejects.toThrow(NotFoundException);
  });
});

function buildDecisionService(application: Record<string, unknown> | null = { id: '31', status: 'under_review' }) {
  const transaction = { id: 'tx-1' };
  const creditRepository = {
    findApplicationById: jest.fn(async (..._args: unknown[]) => application),
    updateApplicationStatus: jest.fn(async (..._args: unknown[]) => undefined),
    createApplicationEvent: jest.fn(async (..._args: unknown[]) => undefined),
    findApplicationEvents: jest.fn(async (..._args: unknown[]) => [{ id: 'event-1' }]),
  };
  const sequelize = {
    transaction: jest.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(transaction)),
  };
  return {
    transaction,
    creditRepository,
    service: new CreditDecisionService(creditRepository as never, sequelize as never),
  };
}

describe('CreditDecisionService', () => {
  it.each<['approve' | 'reject' | 'request_more_information', 'approved' | 'rejected' | 'under_review']>([
    ['approve', 'approved'],
    ['reject', 'rejected'],
    ['request_more_information', 'under_review'],
  ])('mapea %s a %s y escribe estado e historial en una transacción', async (decision, expectedStatus) => {
    const { service, creditRepository, transaction } = buildDecisionService();
    const result = await service.decide({
      tenantId: '7',
      applicationId: '31',
      currentUser: operatorUser,
      body: { decision, reasonCode: 'manual_review', notes: decision === 'approve' ? undefined : 'Evidencia insuficiente' },
    });

    expect(result).toEqual({ applicationId: '31', decision, previousStatus: 'under_review', status: expectedStatus });
    expect(creditRepository.updateApplicationStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: expectedStatus, decidedByInternalUserId: '3' }),
      { transaction },
    );
    expect(creditRepository.createApplicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'decision_recorded', newStatus: expectedStatus, payloadJson: { decision } }),
      { transaction },
    );
  });

  it('rechaza solicitudes inexistentes o ya cerradas sin escribir historial', async () => {
    const missing = buildDecisionService(null);
    await expect(
      missing.service.decide({
        tenantId: '7',
        applicationId: '404',
        currentUser: operatorUser,
        body: { decision: 'approve', reasonCode: 'ok' },
      }),
    ).rejects.toThrow(NotFoundException);

    const closed = buildDecisionService({ id: '31', status: 'approved' });
    await expect(
      closed.service.decide({
        tenantId: '7',
        applicationId: '31',
        currentUser: operatorUser,
        body: { decision: 'approve', reasonCode: 'again' },
      }),
    ).rejects.toThrow(ConflictException);
    expect(closed.creditRepository.updateApplicationStatus).not.toHaveBeenCalled();
  });

  it('devuelve detalle e historial y distingue una solicitud inexistente', async () => {
    const found = buildDecisionService();
    await expect(found.service.getApplicationDetail('7', '31')).resolves.toEqual({
      application: { id: '31', status: 'under_review' },
      events: [{ id: 'event-1' }],
    });

    const missing = buildDecisionService(null);
    await expect(missing.service.getApplicationDetail('7', '404')).rejects.toThrow(NotFoundException);
    expect(missing.creditRepository.findApplicationEvents).not.toHaveBeenCalled();
  });
});
