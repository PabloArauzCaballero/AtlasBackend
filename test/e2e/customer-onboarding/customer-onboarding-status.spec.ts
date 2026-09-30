import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CustomerOnboardingStatusController } from '../../../src/modules/customer-onboarding/customer-onboarding-status.controller.js';
import { CustomerOnboardingStatusService } from '../../../src/modules/customer-onboarding/application/customer-onboarding-status.service.js';
import { OnboardingAbandonmentService } from '../../../src/modules/customer-onboarding/application/onboarding-abandonment.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER, IDEMPOTENCY_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST /customer-onboarding/:customerId/submit`: el único punto del flujo donde
 * se valida completitud y se envía el expediente a revisión. Señalado UNTESTED_WRITE: el spec del
 * servicio prueba `submitForReview` directo, nunca pasó por los guards reales del controller.
 */
describe('CustomerOnboardingStatusController (e2e/supertest) — POST :customerId/submit', () => {
  let app: INestApplication;

  const status = {
    getStatus: jest.fn(async (..._args: unknown[]) => ({ status: 'in_progress' })),
    submitForReview: jest.fn(async (..._args: unknown[]) => ({ status: 'under_review', blockers: [] })),
    listObservations: jest.fn(async (..._args: unknown[]) => ({ observations: [] })),
  };
  const abandonment = { markAbandonedFlows: jest.fn(async (..._args: unknown[]) => ({ evaluated: 0, marked: 0 })) };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [CustomerOnboardingStatusController],
      [
        { provide: CustomerOnboardingStatusService, useValue: status },
        { provide: OnboardingAbandonmentService, useValue: abandonment },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/customer-onboarding/42/submit')
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({})
      .expect(401);
    expect(status.submitForReview).not.toHaveBeenCalled();
  });

  it('rechaza con 403 a un rol ajeno al onboarding (merchant)', async () => {
    await request(app.getHttpServer())
      .post('/customer-onboarding/42/submit')
      .set(...authHeader('merchant'))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({})
      .expect(403);
    expect(status.submitForReview).not.toHaveBeenCalled();
  });

  it('sin clave de idempotencia se rechaza con 400 antes de tocar el estado', async () => {
    await request(app.getHttpServer())
      .post('/customer-onboarding/42/submit')
      .set(...authHeader('customer', { customerId: '42' }))
      .set(...TENANT_HEADER)
      .send({})
      .expect(400);
    expect(status.submitForReview).not.toHaveBeenCalled();
  });

  it('el cliente titular envía su onboarding a revisión y recibe 200', async () => {
    const response = await request(app.getHttpServer())
      .post('/customer-onboarding/42/submit')
      .set(...authHeader('customer', { customerId: '42' }))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ acknowledgement: true })
      .expect(200);

    expect(response.body).toEqual({ status: 'under_review', blockers: [] });
    expect(status.submitForReview).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '1', customerId: '42', idempotencyKey: 'idem-e2e-generic-1' }),
    );
  });
});
