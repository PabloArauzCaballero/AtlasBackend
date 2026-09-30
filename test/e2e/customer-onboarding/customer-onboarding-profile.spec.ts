import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CustomerOnboardingProfileController } from '../../../src/modules/customer-onboarding/customer-onboarding-profile.controller.js';
import { CustomerContactMethodsService } from '../../../src/modules/customer-onboarding/application/customer-contact-methods.service.js';
import { CustomerDocumentUploadService } from '../../../src/modules/customer-onboarding/application/customer-document-upload.service.js';
import { CustomerIdentityProviderVerificationService } from '../../../src/modules/customer-onboarding/application/customer-identity-provider-verification.service.js';
import { CustomerFinancialProfileService } from '../../../src/modules/customer-onboarding/application/customer-financial-profile.service.js';
import { CustomerProfileUpdateService } from '../../../src/modules/customer-onboarding/application/customer-profile-update.service.js';
import { CustomerReferenceContactsService } from '../../../src/modules/customer-onboarding/application/customer-reference-contacts.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER, IDEMPOTENCY_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `CustomerOnboardingProfileController`: quién puede escribir en el expediente
 * de un cliente mientras onboarding avanza, y qué exige cada ruta antes de delegar.
 *
 * Las tres rutas que cubre esta suite (`identity-verification`, `reference-contacts`,
 * `financial-profile`) estaban señaladas como UNTESTED_WRITE por la auditoría: ningún test
 * existente nombraba su ruta HTTP exacta, sólo llamaban al método del controlador directamente
 * (`test/unit/.../customer-onboarding-profile.controller.spec.ts`), sin pasar por guards reales.
 */
describe('CustomerOnboardingProfileController (e2e/supertest)', () => {
  let app: INestApplication;

  const profile = { updateProfile: jest.fn(async (..._args: unknown[]) => ({ status: 'ok' })) };
  const financial = { upsertFinancialProfile: jest.fn(async (..._args: unknown[]) => ({ status: 'ok' })) };
  const references = {
    listReferences: jest.fn(async (..._args: unknown[]) => ({ references: [] })),
    addReferences: jest.fn(async (..._args: unknown[]) => ({ references: [] })),
    removeReference: jest.fn(async (..._args: unknown[]) => ({ status: 'removed' })),
  };
  const contacts = { addContactMethod: jest.fn(async (..._args: unknown[]) => ({ status: 'ok' })) };
  const uploads = { createUploadUrl: jest.fn(async (..._args: unknown[]) => ({ storageKey: 'k/1' })) };
  const identity = {
    verifyWithProvider: jest.fn(async (..._args: unknown[]) => ({ verdict: 'verified' })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [CustomerOnboardingProfileController],
      [
        { provide: CustomerProfileUpdateService, useValue: profile },
        { provide: CustomerFinancialProfileService, useValue: financial },
        { provide: CustomerReferenceContactsService, useValue: references },
        { provide: CustomerContactMethodsService, useValue: contacts },
        { provide: CustomerDocumentUploadService, useValue: uploads },
        { provide: CustomerIdentityProviderVerificationService, useValue: identity },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PUT /customer-onboarding/:customerId/financial-profile', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .put('/customer-onboarding/42/financial-profile')
        .set(...TENANT_HEADER)
        .send({ monthlyIncomeDeclared: 1500 })
        .expect(401);
      expect(financial.upsertFinancialProfile).not.toHaveBeenCalled();
    });

    it('rechaza con 403 a un rol ajeno al onboarding (merchant)', async () => {
      await request(app.getHttpServer())
        .put('/customer-onboarding/42/financial-profile')
        .set(...authHeader('merchant'))
        .set(...TENANT_HEADER)
        .send({ monthlyIncomeDeclared: 1500 })
        .expect(403);
      expect(financial.upsertFinancialProfile).not.toHaveBeenCalled();
    });

    it('un campo fuera del esquema (strict) se rechaza con 400', async () => {
      await request(app.getHttpServer())
        .put('/customer-onboarding/42/financial-profile')
        .set(...authHeader('customer', { customerId: '42' }))
        .set(...TENANT_HEADER)
        .send({ monthlyIncomeDeclared: 1500, notAField: true })
        .expect(400);
      expect(financial.upsertFinancialProfile).not.toHaveBeenCalled();
    });

    it('el cliente titular actualiza su perfil económico y recibe 200', async () => {
      await request(app.getHttpServer())
        .put('/customer-onboarding/42/financial-profile')
        .set(...authHeader('customer', { customerId: '42' }))
        .set(...TENANT_HEADER)
        .send({ monthlyIncomeDeclared: 1500 })
        .expect(200);

      expect(financial.upsertFinancialProfile).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: '1', customerId: '42', body: { monthlyIncomeDeclared: 1500 } }),
      );
    });
  });

  describe('POST /customer-onboarding/:customerId/reference-contacts', () => {
    const REFERENCE = {
      relationshipType: 'family',
      fullName: 'Juana Pérez Quispe',
      phone: '71234567',
      consentBasis: 'customer_declared',
    };

    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/reference-contacts')
        .set(...TENANT_HEADER)
        .send({ references: [REFERENCE] })
        .expect(401);
      expect(references.addReferences).not.toHaveBeenCalled();
    });

    it('rechaza con 403 a un rol ajeno al onboarding (merchant)', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/reference-contacts')
        .set(...authHeader('merchant'))
        .set(...TENANT_HEADER)
        .send({ references: [REFERENCE] })
        .expect(403);
      expect(references.addReferences).not.toHaveBeenCalled();
    });

    it('sin consentBasis (de catálogo cerrado) se rechaza con 400', async () => {
      const { consentBasis: _omit, ...sinConsentimiento } = REFERENCE;
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/reference-contacts')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({ references: [sinConsentimiento] })
        .expect(400);
      expect(references.addReferences).not.toHaveBeenCalled();
    });

    it('un operador interno registra la referencia y recibe 201', async () => {
      const response = await request(app.getHttpServer())
        .post('/customer-onboarding/42/reference-contacts')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({ references: [REFERENCE] })
        .expect(201);

      expect(response.body).toEqual({ references: [] });
      expect(references.addReferences).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: '1', customerId: '42', body: { references: [REFERENCE] } }),
      );
    });
  });

  describe('POST /customer-onboarding/:customerId/identity-verification', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/identity-verification')
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ documentNumber: '1234567' })
        .expect(401);
      expect(identity.verifyWithProvider).not.toHaveBeenCalled();
    });

    it('rechaza con 403 a un rol ajeno al onboarding (merchant)', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/identity-verification')
        .set(...authHeader('merchant'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ documentNumber: '1234567' })
        .expect(403);
      expect(identity.verifyWithProvider).not.toHaveBeenCalled();
    });

    it('sin clave de idempotencia se rechaza con 400 antes de consultar al proveedor', async () => {
      await request(app.getHttpServer())
        .post('/customer-onboarding/42/identity-verification')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({ documentNumber: '1234567' })
        .expect(400);
      expect(identity.verifyWithProvider).not.toHaveBeenCalled();
    });

    it('un analista de riesgo dispara la verificación y recibe 200 con el resultado', async () => {
      const response = await request(app.getHttpServer())
        .post('/customer-onboarding/42/identity-verification')
        .set(...authHeader('risk_analyst'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ documentNumber: '1234567' })
        .expect(200);

      expect(response.body).toEqual({ verdict: 'verified' });
      expect(identity.verifyWithProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: '1',
          customerId: '42',
          body: { documentNumber: '1234567' },
          idempotencyKey: 'idem-e2e-generic-1',
        }),
      );
    });
  });
});
