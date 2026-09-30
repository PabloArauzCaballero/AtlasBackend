import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CustomerEligibilityController } from '../../../src/modules/customers/customer-eligibility.controller.js';
import { CustomerEligibilityService } from '../../../src/modules/customers/application/customer-eligibility.service.js';
import { CustomerEligibilityDecisionService } from '../../../src/modules/customers/application/customer-eligibility-decision.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST operations/customers/:customerId/eligibility/decision`.
 *
 * Es la puerta que aprueba, rechaza, observa, suspende o reincorpora a un cliente. La UI no protege
 * nada acá: el rol `customer` (que SÍ puede leer su propia habilitación por `GET .../eligibility`)
 * no puede escribir esta decisión, y es exactamente lo que este archivo demuestra.
 */
describe('CustomerEligibilityController — decisión de operaciones (e2e/supertest)', () => {
  let app: INestApplication;

  const eligibilityService = {
    getEligibility: jest.fn(async (..._args: unknown[]) => ({ eligible: true, blockers: [] })),
  };
  const decisionService = {
    decide: jest.fn(async (..._args: unknown[]) => ({ previousStatus: 'under_review', newStatus: 'approved', blockers: [] })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [CustomerEligibilityController],
      [
        { provide: CustomerEligibilityService, useValue: eligibilityService },
        { provide: CustomerEligibilityDecisionService, useValue: decisionService },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/operations/customers/1/eligibility/decision')
      .set(...TENANT_HEADER)
      .send({ decision: 'approve', reasonCode: 'cumple' })
      .expect(401);
    expect(decisionService.decide).not.toHaveBeenCalled();
  });

  it('un customer NO puede decidir su propia habilitación', async () => {
    await request(app.getHttpServer())
      .post('/operations/customers/1/eligibility/decision')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .send({ decision: 'approve', reasonCode: 'cumple' })
      .expect(403);
    expect(decisionService.decide).not.toHaveBeenCalled();
  });

  it('un fraud_analyst NO está en la lista de roles habilitados para decidir', async () => {
    // El controlador lo admite para CONSULTAR (getEligibility) pero no para decidir.
    await request(app.getHttpServer())
      .post('/operations/customers/1/eligibility/decision')
      .set(...authHeader('fraud_analyst'))
      .set(...TENANT_HEADER)
      .send({ decision: 'approve', reasonCode: 'cumple' })
      .expect(403);
    expect(decisionService.decide).not.toHaveBeenCalled();
  });

  it('rechazar sin nota se rechaza en el borde (400)', async () => {
    await request(app.getHttpServer())
      .post('/operations/customers/1/eligibility/decision')
      .set(...authHeader('risk_analyst'))
      .set(...TENANT_HEADER)
      .send({ decision: 'reject', reasonCode: 'no_cumple' })
      .expect(400);
    expect(decisionService.decide).not.toHaveBeenCalled();
  });

  it('un risk_analyst aprueba y recibe 200 con el resultado del servicio', async () => {
    const response = await request(app.getHttpServer())
      .post('/operations/customers/1/eligibility/decision')
      .set(...authHeader('risk_analyst'))
      .set(...TENANT_HEADER)
      .send({ decision: 'approve', reasonCode: 'cumple_condiciones' })
      .expect(200);

    expect(response.body).toMatchObject({ newStatus: 'approved' });
    expect(decisionService.decide).toHaveBeenCalledTimes(1);
    const [[input]] = decisionService.decide.mock.calls as unknown as [
      [{ tenantId: string; customerId: string; decision: string; reasonCode: string }],
    ];
    expect(input.tenantId).toBe('1');
    expect(input.customerId).toBe('1');
    expect(input.decision).toBe('approve');
  });
});
