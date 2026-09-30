import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CreditOperationsController } from '../../../src/modules/credit/credit-operations.controller.js';
import { CreditBusinessAcceptanceService } from '../../../src/modules/credit/application/credit-business-acceptance.service.js';
import { CreditDecisionService } from '../../../src/modules/credit/application/credit-decision.service.js';
import { CreditLineService } from '../../../src/modules/credit/application/credit-line.service.js';
import { CreditProductService } from '../../../src/modules/credit/application/credit-product.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de la consola de operaciones de crédito:
 *  - `POST operations/credit/customers/:customerId/credit-line/recalculate`
 *  - `POST operations/credit/applications/:applicationId/business-acceptance`
 *
 * El controlador entero exige `@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')`
 * a nivel de clase: no hay rol adicional por ruta que fijar, así que la suite prueba las dos rutas
 * contra ese mismo umbral.
 */
describe('CreditOperationsController (e2e/supertest)', () => {
  let app: INestApplication;

  const creditLines = {
    recalculate: jest.fn(async (..._args: unknown[]) => ({
      id: '1',
      customerId: '77',
      amount: '500.00',
      currencyCode: 'BOB',
      status: 'active',
    })),
  };
  const businessAcceptance = { decide: jest.fn(async (..._args: unknown[]) => ({ applicationId: '5', businessAcceptance: 'accepted' })) };
  const decisionService = { decide: jest.fn(), getApplicationDetail: jest.fn() };
  const productService = { listForOperations: jest.fn(), createProduct: jest.fn(), changeStatus: jest.fn() };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [CreditOperationsController],
      [
        { provide: CreditProductService, useValue: productService },
        { provide: CreditDecisionService, useValue: decisionService },
        { provide: CreditBusinessAcceptanceService, useValue: businessAcceptance },
        { provide: CreditLineService, useValue: creditLines },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST operations/credit/customers/:customerId/credit-line/recalculate', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/operations/credit/customers/77/credit-line/recalculate')
        .set(...TENANT_HEADER)
        .expect(401);
      expect(creditLines.recalculate).not.toHaveBeenCalled();
    });

    it('un cliente NO puede recalcular su propia línea: es consola interna', async () => {
      await request(app.getHttpServer())
        .post('/operations/credit/customers/77/credit-line/recalculate')
        .set(...authHeader('customer', { customerId: '77' }))
        .set(...TENANT_HEADER)
        .expect(403);
      expect(creditLines.recalculate).not.toHaveBeenCalled();
    });

    it('un operador interno recalcula y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/operations/credit/customers/77/credit-line/recalculate')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .expect(200);

      expect(response.body).toMatchObject({ customerId: '77' });
      const [[input]] = creditLines.recalculate.mock.calls as unknown as [[{ tenantId: string; customerId: string; trigger: string }]];
      expect(input.tenantId).toBe('1');
      expect(input.customerId).toBe('77');
      expect(input.trigger).toBe('manual');
    });

    it('si el motor no responde, devuelve 503 sin tocar la línea vigente', async () => {
      creditLines.recalculate.mockResolvedValueOnce(null as never);
      await request(app.getHttpServer())
        .post('/operations/credit/customers/77/credit-line/recalculate')
        .set(...authHeader('risk_analyst'))
        .set(...TENANT_HEADER)
        .expect(503);
    });
  });

  describe('POST operations/credit/applications/:applicationId/business-acceptance', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/operations/credit/applications/5/business-acceptance')
        .set(...TENANT_HEADER)
        .send({ accepted: true })
        .expect(401);
      expect(businessAcceptance.decide).not.toHaveBeenCalled();
    });

    it('un comercio (merchant) NO tiene acceso a esta consola interna', async () => {
      // Aquí, a diferencia de `merchant/partners/.../acceptance`, no hay rol `merchant`
      // declarado en absoluto: es la consola de personal interno.
      await request(app.getHttpServer())
        .post('/operations/credit/applications/5/business-acceptance')
        .set(...authHeader('merchant'))
        .set(...TENANT_HEADER)
        .send({ accepted: true })
        .expect(403);
      expect(businessAcceptance.decide).not.toHaveBeenCalled();
    });

    it('rechaza declinar sin motivo', async () => {
      await request(app.getHttpServer())
        .post('/operations/credit/applications/5/business-acceptance')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({ accepted: false })
        .expect(400);
      expect(businessAcceptance.decide).not.toHaveBeenCalled();
    });

    it('un analista de riesgo decide y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/operations/credit/applications/5/business-acceptance')
        .set(...authHeader('risk_analyst'))
        .set(...TENANT_HEADER)
        .send({ accepted: true })
        .expect(200);

      expect(response.body).toMatchObject({ applicationId: '5' });
      const [[input]] = businessAcceptance.decide.mock.calls as unknown as [[{ tenantId: string; applicationId: string }]];
      expect(input.tenantId).toBe('1');
      expect(input.applicationId).toBe('5');
    });
  });
});
