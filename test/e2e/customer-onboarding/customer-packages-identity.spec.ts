import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CustomerPackagesController } from '../../../src/modules/customer-onboarding/customer-packages.controller.js';
import { CustomerOnboardingService } from '../../../src/modules/customer-onboarding/customer-onboarding.service.js';
import { IdentityManualReviewOutcomeService } from '../../../src/modules/customer-onboarding/application/identity-manual-review-outcome.service.js';
import { CustomerContactsSnapshotService } from '../../../src/modules/customer-onboarding/application/customer-contacts-snapshot.service.js';
import { authHeader, buildGenericTestApp, IDEMPOTENCY_HEADER, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST customer-onboarding/:customerId/identity-package` (hallazgo
 * UNTESTED_WRITE): entrega los documentos de identidad y la biometría que después sostienen una
 * decisión de riesgo, así que quién puede enviarlos no es un detalle — es evidencia KYC.
 *
 * `@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')` de método;
 * se usa `fraud_analyst` para el 403 porque no está en esa lista aunque sí pueda leer expedientes.
 * `expiresAt` en el futuro y un mínimo de evidencia son obligatorios en el esquema Zod del endpoint
 * (`identityPackageSchema`), así que el caso de body inválido usa un documento ya vencido.
 */
describe('CustomerPackagesController — POST customer-onboarding/:customerId/identity-package (e2e/supertest)', () => {
  let app: INestApplication;

  const onboarding = {
    submitIdentityPackage: jest.fn(async (..._args: unknown[]) => ({ status: 'queued' })),
    submitAddressPackage: jest.fn(async () => ({})),
  };
  const manualReview = { apply: jest.fn(async () => ({})) };
  const contactsSnapshot = { submit: jest.fn(async () => ({})) };

  const evidencia = [
    {
      evidenceType: 'identity_front',
      storageKey: 'expedientes/42/identity-front.jpg',
      mimeType: 'image/jpeg',
      sha256Hash: 'a'.repeat(64),
    },
  ];

  const identidadVigente = {
    documentType: 'ci',
    documentNumberHash: 'b'.repeat(64),
    documentLast4: '1234',
    countryCode: 'BOL',
    expiresAt: '2099-12-31',
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [CustomerPackagesController],
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

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/customer-onboarding/42/identity-package')
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ identity: identidadVigente, evidence: evidencia })
      .expect(401);
    expect(onboarding.submitIdentityPackage).not.toHaveBeenCalled();
  });

  it('un rol fuera de la lista (fraud_analyst) recibe 403', async () => {
    await request(app.getHttpServer())
      .post('/customer-onboarding/42/identity-package')
      .set(...authHeader('fraud_analyst'))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ identity: identidadVigente, evidence: evidencia })
      .expect(403);
    expect(onboarding.submitIdentityPackage).not.toHaveBeenCalled();
  });

  it('un documento de identidad vencido se rechaza antes de encolar el paquete', async () => {
    await request(app.getHttpServer())
      .post('/customer-onboarding/42/identity-package')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ identity: { ...identidadVigente, expiresAt: '2020-01-01' }, evidence: evidencia })
      .expect(400);
    expect(onboarding.submitIdentityPackage).not.toHaveBeenCalled();
  });

  it('sin ninguna evidencia adjunta se rechaza antes de encolar el paquete', async () => {
    await request(app.getHttpServer())
      .post('/customer-onboarding/42/identity-package')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ identity: identidadVigente, evidence: [] })
      .expect(400);
    expect(onboarding.submitIdentityPackage).not.toHaveBeenCalled();
  });

  it('el propio cliente entrega su paquete de identidad y recibe 202', async () => {
    const response = await request(app.getHttpServer())
      .post('/customer-onboarding/42/identity-package')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ identity: identidadVigente, evidence: evidencia })
      .expect(202);

    expect(response.body).toMatchObject({ status: 'queued' });
    const [[input]] = onboarding.submitIdentityPackage.mock.calls as unknown as [
      [{ customerId: string; idempotencyKey: string; body: { evidence: unknown[] } }],
    ];
    expect(input.customerId).toBe('42');
    expect(input.idempotencyKey).toBe('idem-e2e-generic-1');
    expect(input.body.evidence).toHaveLength(1);
  });
});
