/**
 * @file Verifica la traducción HTTP de crédito hacia los casos de uso.
 * @business Evita que tenant, cliente o idempotencia se pierdan entre el contrato HTTP y la decisión crediticia.
 * @system Prueba delegación y normalización de CreditController y CreditOperationsController.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CreditOperationsController } from '../../../src/modules/credit/credit-operations.controller.js';
import { CreditController } from '../../../src/modules/credit/credit.controller.js';

const customerUser = { sub: 'customer-10', tenantId: '7', customerId: '10', role: 'customer' } as never;
const operatorUser = { sub: 'operator-3', tenantId: '7', internalUserId: '3', role: 'admin' } as never;

describe('CreditController', () => {
  function build() {
    const productService = { listForCustomer: jest.fn(async (input: unknown) => input) };
    const applicationService = {
      createApplication: jest.fn(async (input: unknown) => input),
      listApplications: jest.fn(async (input: unknown) => input),
    };
    return {
      productService,
      applicationService,
      controller: new CreditController(productService as never, applicationService as never),
    };
  }

  it('usa el tenant del token para listar productos cuando no llega header', async () => {
    const { controller, productService } = build();
    await controller.listProducts(undefined, { customerId: '10' }, customerUser);
    expect(productService.listForCustomer).toHaveBeenCalledWith({ tenantId: '7', customerId: '10', currentUser: customerUser });
  });

  it('exige tenant e idempotencia al crear la solicitud', async () => {
    const { controller, applicationService } = build();
    const body = { productId: '21', requestedAmount: 1500, requestedTermMonths: 6 };
    await controller.createApplication('7', 'idem-77', { customerId: '10' }, body, customerUser);
    expect(applicationService.createApplication).toHaveBeenCalledWith({
      tenantId: '7',
      customerId: '10',
      body,
      currentUser: customerUser,
      idempotencyKey: 'idem-77',
    });
  });

  it('delega el listado de solicitudes con el tenant del header', async () => {
    const { controller, applicationService } = build();
    await controller.listApplications('8', { customerId: '10' }, customerUser);
    expect(applicationService.listApplications).toHaveBeenCalledWith({ tenantId: '8', customerId: '10', currentUser: customerUser });
  });
});

describe('CreditOperationsController', () => {
  function build() {
    const productService = {
      listForOperations: jest.fn(async (tenantId: string) => tenantId),
      createProduct: jest.fn(async (input: unknown) => input),
      changeStatus: jest.fn(async (input: unknown) => input),
    };
    const decisionService = {
      decide: jest.fn(async (input: unknown) => input),
      getApplicationDetail: jest.fn(async (tenantId: string, applicationId: string) => ({ tenantId, applicationId })),
    };
    return {
      productService,
      decisionService,
      controller: new CreditOperationsController(productService as never, decisionService as never),
    };
  }

  it('lista el catálogo del tenant operativo', async () => {
    const { controller, productService } = build();
    await controller.listProducts('7');
    expect(productService.listForOperations).toHaveBeenCalledWith('7');
  });

  it('delega el alta de producto con actor y tenant', async () => {
    const { controller, productService } = build();
    const body = {
      productCode: 'micro_6',
      productName: 'Microcrédito seis meses',
      currencyCode: 'BOB',
      minAmount: 1000,
      maxAmount: 9000,
      minTermMonths: 3,
      maxTermMonths: 6,
      requiresManualReview: false,
    };
    await controller.createProduct('7', body, operatorUser);
    expect(productService.createProduct).toHaveBeenCalledWith({ tenantId: '7', body, currentUser: operatorUser });
  });

  it('delega el cambio de estado usando solo el estado validado', async () => {
    const { controller, productService } = build();
    await controller.changeProductStatus('7', { productId: '21' }, { status: 'active', reasonCode: 'approved' }, operatorUser);
    expect(productService.changeStatus).toHaveBeenCalledWith({
      tenantId: '7',
      productId: '21',
      status: 'active',
      currentUser: operatorUser,
    });
  });

  it('delega decisión y consulta de detalle con el tenant requerido', async () => {
    const { controller, decisionService } = build();
    const body = { decision: 'approve' as const, reasonCode: 'manual_review_complete' };
    await controller.decideApplication('7', '31', body, operatorUser);
    expect(decisionService.decide).toHaveBeenCalledWith({
      tenantId: '7',
      applicationId: '31',
      body,
      currentUser: operatorUser,
    });

    await controller.getApplicationDetail('7', '31');
    expect(decisionService.getApplicationDetail).toHaveBeenCalledWith('7', '31');
  });
});
