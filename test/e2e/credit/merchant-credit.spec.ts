import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CreditBusinessAcceptanceService } from '../../../src/modules/credit/application/credit-business-acceptance.service.js';
import { MerchantCreditController } from '../../../src/modules/credit/merchant-credit.controller.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST merchant/partners/:partnerId/credit-applications/:applicationId/acceptance`.
 *
 * Es la respuesta del COMERCIO a una compra que el motor ya aprobó. La propiedad del expediente se
 * comprueba DENTRO del servicio (`assertMayDecide`, contra `application.partnerProfileId`), no en un
 * guard: el controlador solo exige el rol de la clase. Por eso esta suite fija el nivel que el HTTP
 * sí puede fijar —quién entra por rol— y deja la comprobación de propiedad fina a las pruebas del
 * servicio, que sí pueden cargar un expediente de verdad.
 */
describe('MerchantCreditController (e2e/supertest) — POST .../credit-applications/:applicationId/acceptance', () => {
  let app: INestApplication;

  const businessAcceptance = {
    listForPartner: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    decide: jest.fn(async (..._args: unknown[]) => ({ applicationId: '5', businessAcceptance: 'accepted' })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [MerchantCreditController],
      [{ provide: CreditBusinessAcceptanceService, useValue: businessAcceptance }],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/merchant/partners/9/credit-applications/5/acceptance')
      .set(...TENANT_HEADER)
      .send({ accepted: true })
      .expect(401);
    expect(businessAcceptance.decide).not.toHaveBeenCalled();
  });

  it('un rol sin acceso a este contrato (fraud_analyst) NO puede decidir', async () => {
    // La clase declara `@Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')`.
    // `fraud_analyst` queda fuera: es la cola de fraude, no la del comercio.
    await request(app.getHttpServer())
      .post('/merchant/partners/9/credit-applications/5/acceptance')
      .set(...authHeader('fraud_analyst'))
      .set(...TENANT_HEADER)
      .send({ accepted: true })
      .expect(403);
    expect(businessAcceptance.decide).not.toHaveBeenCalled();
  });

  it('rechaza el cuerpo: declinar sin motivo es un 400 antes de llegar al servicio', async () => {
    await request(app.getHttpServer())
      .post('/merchant/partners/9/credit-applications/5/acceptance')
      .set(...authHeader('merchant'))
      .set(...TENANT_HEADER)
      .send({ accepted: false })
      .expect(400);
    expect(businessAcceptance.decide).not.toHaveBeenCalled();
  });

  it('el comercio puede aceptar la compra y recibe 200', async () => {
    const response = await request(app.getHttpServer())
      .post('/merchant/partners/9/credit-applications/5/acceptance')
      .set(...authHeader('merchant'))
      .set(...TENANT_HEADER)
      .send({ accepted: true })
      .expect(200);

    expect(response.body).toMatchObject({ applicationId: '5' });
    const [[input]] = businessAcceptance.decide.mock.calls as unknown as [[{ tenantId: string; applicationId: string }]];
    expect(input.tenantId).toBe('1');
    expect(input.applicationId).toBe('5');
  });

  it('personal interno (internal_operator) también puede decidir, para cuando el comercio no responde', async () => {
    await request(app.getHttpServer())
      .post('/merchant/partners/9/credit-applications/5/acceptance')
      .set(...authHeader('internal_operator'))
      .set(...TENANT_HEADER)
      .send({ accepted: true })
      .expect(200);
    expect(businessAcceptance.decide).toHaveBeenCalled();
  });
});
