import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CustomerOnboardingController } from '../../../src/modules/customer-onboarding/customer-onboarding.controller.js';
import { CustomerOnboardingService } from '../../../src/modules/customer-onboarding/customer-onboarding.service.js';
import { IdentityManualReviewOutcomeService } from '../../../src/modules/customer-onboarding/application/identity-manual-review-outcome.service.js';
import { CustomerContactsSnapshotService } from '../../../src/modules/customer-onboarding/application/customer-contacts-snapshot.service.js';
import { authHeader, buildGenericTestApp, IDEMPOTENCY_HEADER, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de las dos rutas del OTP de contacto (hallazgo UNTESTED_WRITE):
 * `POST customer-onboarding/:customerId/contact-verification/request` y `.../submit`.
 *
 * Las dos comparten el mismo `@Roles('customer', 'internal_operator', 'risk_analyst', 'admin',
 * 'platform_admin')` de método: el rol de clase no aplica aquí porque el controlador no declara
 * uno (sólo `@Public()` en las rutas que sí lo llevan). `fraud_analyst` no está en esa lista, así
 * que es el rol que se usa para probar el 403 — ni la investigación de fraude puede disparar ni
 * confirmar un código ajeno.
 */
describe('CustomerOnboardingController — verificación de contacto (e2e/supertest)', () => {
  let app: INestApplication;

  const onboarding = {
    verificationChannels: jest.fn(() => []),
    startOnboarding: jest.fn(async () => ({})),
    requestContactVerification: jest.fn(async (..._args: unknown[]) => ({ status: 'sent' })),
    submitContactVerification: jest.fn(async (..._args: unknown[]) => ({ verified: true })),
    submitIdentityPackage: jest.fn(async () => ({})),
    submitAddressPackage: jest.fn(async () => ({})),
  };
  const manualReview = { apply: jest.fn(async () => ({})) };
  const contactsSnapshot = { submit: jest.fn(async () => ({})) };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [CustomerOnboardingController],
      [
        { provide: CustomerOnboardingService, useValue: onboarding },
        { provide: IdentityManualReviewOutcomeService, useValue: manualReview },
        { provide: CustomerContactsSnapshotService, useValue: contactsSnapshot },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST customer-onboarding/:customerId/contact-verification/request', () => {
    const body = { contactType: 'phone', verificationChannel: 'sms' };

    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/contact-verification/request')
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send(body)
        .expect(401);
      expect(onboarding.requestContactVerification).not.toHaveBeenCalled();
    });

    it('un rol fuera de la lista (fraud_analyst) recibe 403', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/contact-verification/request')
        .set(...authHeader('fraud_analyst'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send(body)
        .expect(403);
      expect(onboarding.requestContactVerification).not.toHaveBeenCalled();
    });

    it('un cuerpo con un canal fuera del catálogo se rechaza antes de enviar el código', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/contact-verification/request')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ contactType: 'phone', verificationChannel: 'carrier-pigeon' })
        .expect(400);
      expect(onboarding.requestContactVerification).not.toHaveBeenCalled();
    });

    it('un operador interno pide el código y recibe 202 con el id del cliente en el argumento', async () => {
      const response = await request(app.getHttpServer())
        .post('/customer-onboarding/42/contact-verification/request')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send(body)
        .expect(202);

      expect(response.body).toMatchObject({ status: 'sent' });
      const [[input]] = onboarding.requestContactVerification.mock.calls as unknown as [[{ customerId: string; idempotencyKey: string }]];
      expect(input.customerId).toBe('42');
      expect(input.idempotencyKey).toBe('idem-e2e-generic-1');
    });
  });

  describe('POST customer-onboarding/:customerId/contact-verification/submit', () => {
    const body = { contactType: 'phone', verificationChannel: 'sms', verificationCode: '135790' };

    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/contact-verification/submit')
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send(body)
        .expect(401);
      expect(onboarding.submitContactVerification).not.toHaveBeenCalled();
    });

    it('un rol fuera de la lista (fraud_analyst) recibe 403', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/contact-verification/submit')
        .set(...authHeader('fraud_analyst'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send(body)
        .expect(403);
      expect(onboarding.submitContactVerification).not.toHaveBeenCalled();
    });

    it('un código demasiado corto se rechaza antes de validarlo', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/contact-verification/submit')
        .set(...authHeader('customer'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ contactType: 'phone', verificationChannel: 'sms', verificationCode: '12' })
        .expect(400);
      expect(onboarding.submitContactVerification).not.toHaveBeenCalled();
    });

    it('el propio cliente confirma su código y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/customer-onboarding/42/contact-verification/submit')
        .set(...authHeader('customer'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send(body)
        .expect(200);

      expect(response.body).toMatchObject({ verified: true });
      const [[input]] = onboarding.submitContactVerification.mock.calls as unknown as [[{ customerId: string; body: { verificationCode: string } }]];
      expect(input.customerId).toBe('42');
      expect(input.body.verificationCode).toBe('135790');
    });
  });
});
