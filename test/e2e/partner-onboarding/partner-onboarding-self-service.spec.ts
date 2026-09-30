import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PartnerOnboardingController } from '../../../src/modules/partner-onboarding/partner-onboarding.controller.js';
import { PartnerProfileService } from '../../../src/modules/partner-onboarding/application/partner-profile.service.js';
import { PartnerDirectoryService } from '../../../src/modules/partner-onboarding/application/partner-directory.service.js';
import { PartnerRepresentativeService } from '../../../src/modules/partner-onboarding/application/partner-representative.service.js';
import { PartnerCommerceService } from '../../../src/modules/partner-onboarding/application/partner-commerce.service.js';
import { PartnerQrService } from '../../../src/modules/partner-onboarding/application/partner-qr.service.js';
import { PartnerVerificationService } from '../../../src/modules/partner-onboarding/application/partner-verification.service.js';
import { PartnerOwnershipGuard } from '../../../src/modules/partner-onboarding/partner-ownership.guard.js';
import { PartnerOnboardingRepository } from '../../../src/modules/partner-onboarding/partner-onboarding.repository.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `PartnerOnboardingController`: el expediente de comercio, autoservicio para
 * `merchant` hasta que se envía a revisión.
 *
 * `PartnerOwnershipGuard` (guard de clase) es el control que de verdad separa a un comercio de
 * otro: sin él, cambiar `:partnerId` en la URL bastaba para operar sobre el expediente ajeno
 * (hallazgo del 20-ago-2026, ver el propio guard). El doble de `PartnerOnboardingRepository`
 * simulado aquí ejercita los tres niveles de su contrato: expediente inexistente (el guard deja
 * pasar — el 404 lo da el caso de uso), expediente propio (pasa), y expediente AJENO (403 del
 * guard, antes de tocar el servicio).
 */
describe('PartnerOnboardingController — autoservicio del comercio (e2e/supertest)', () => {
  let app: INestApplication;

  const DUEÑO = 'merchant-user-77';
  const PARTNER_ID = '10';

  const profiles = {
    start: jest.fn(async (..._args: unknown[]) => ({ id: PARTNER_ID, onboardingStatus: 'draft' })),
    requireProfile: jest.fn(async (..._args: unknown[]) => ({ id: PARTNER_ID, onboardingStatus: 'draft' })),
    setCommercialRegistry: jest.fn(async (..._args: unknown[]) => ({ id: PARTNER_ID })),
    updateCommercialProfile: jest.fn(async (..._args: unknown[]) => ({ id: PARTNER_ID })),
    submit: jest.fn(async (..._args: unknown[]) => ({ profile: { id: PARTNER_ID, onboardingStatus: 'under_review' } })),
  };
  const directory = { listOwnedBy: jest.fn(async () => []) };
  const representatives = {
    addLegalRepresentative: jest.fn(async (..._args: unknown[]) => ({})),
    createDocumentUploadTicket: jest.fn(async (..._args: unknown[]) => ({
      uploadUrl: 'https://storage.example/put',
      storageKey: `1/${PARTNER_ID}/power-of-attorney.pdf`,
    })),
  };
  const commerce = { listBranches: jest.fn(async () => []), listPosTerminals: jest.fn(async () => []) };
  const qr = { list: jest.fn(async () => []) };
  const verification = { findSubmissionGaps: jest.fn(async () => []) };

  // Doble del repositorio que `PartnerOwnershipGuard` consulta para resolver el dueño del expediente.
  const ownershipRepository = {
    findProfileById: jest.fn(async (_tenantId: string, partnerId: string) =>
      partnerId === PARTNER_ID ? { ownerMerchantUserId: DUEÑO } : null,
    ),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [PartnerOnboardingController],
      [
        { provide: PartnerProfileService, useValue: profiles },
        { provide: PartnerDirectoryService, useValue: directory },
        { provide: PartnerRepresentativeService, useValue: representatives },
        { provide: PartnerCommerceService, useValue: commerce },
        { provide: PartnerQrService, useValue: qr },
        { provide: PartnerVerificationService, useValue: verification },
        PartnerOwnershipGuard,
        { provide: PartnerOnboardingRepository, useValue: ownershipRepository },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST partner-onboarding/:partnerId/documents/upload-url', () => {
    const body = { documentKind: 'power-of-attorney', contentType: 'application/pdf', sizeBytes: 1024 };

    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/documents/upload-url`)
        .set(...TENANT_HEADER)
        .send(body)
        .expect(401);
      expect(representatives.createDocumentUploadTicket).not.toHaveBeenCalled();
    });

    it('un customer NO está entre los roles habilitados', async () => {
      await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/documents/upload-url`)
        .set(...authHeader('customer', { merchantUserId: DUEÑO }))
        .set(...TENANT_HEADER)
        .send(body)
        .expect(403);
      expect(representatives.createDocumentUploadTicket).not.toHaveBeenCalled();
    });

    it('un merchant DUEÑO de otro expediente no puede pedir el permiso — 403 del guard de propiedad', async () => {
      await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/documents/upload-url`)
        .set(...authHeader('merchant', { merchantUserId: 'otro-comercio' }))
        .set(...TENANT_HEADER)
        .send(body)
        .expect(403);
      expect(representatives.createDocumentUploadTicket).not.toHaveBeenCalled();
    });

    it('el merchant DUEÑO del expediente obtiene el permiso de subida (201)', async () => {
      const response = await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/documents/upload-url`)
        .set(...authHeader('merchant', { merchantUserId: DUEÑO }))
        .set(...TENANT_HEADER)
        .send(body)
        .expect(201);

      expect(response.body).toMatchObject({ storageKey: expect.stringContaining(PARTNER_ID) });
      expect(representatives.createDocumentUploadTicket).toHaveBeenCalledTimes(1);
      const [[tenantId, partnerId]] = representatives.createDocumentUploadTicket.mock.calls as unknown as [[string, string]];
      expect(tenantId).toBe('1');
      expect(partnerId).toBe(PARTNER_ID);
    });

    it('un tipo de documento fuera del catálogo se rechaza en el borde (400)', async () => {
      await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/documents/upload-url`)
        .set(...authHeader('merchant', { merchantUserId: DUEÑO }))
        .set(...TENANT_HEADER)
        .send({ ...body, documentKind: 'contrato-social' })
        .expect(400);
    });
  });

  describe('POST partner-onboarding/:partnerId/submit', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/submit`)
        .set(...TENANT_HEADER)
        .expect(401);
      expect(profiles.submit).not.toHaveBeenCalled();
    });

    it('un merchant AJENO al expediente no puede enviarlo — 403 del guard de propiedad', async () => {
      await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/submit`)
        .set(...authHeader('merchant', { merchantUserId: 'otro-comercio' }))
        .set(...TENANT_HEADER)
        .expect(403);
      expect(profiles.submit).not.toHaveBeenCalled();
    });

    it('el merchant DUEÑO envía su expediente a revisión y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/submit`)
        .set(...authHeader('merchant', { merchantUserId: DUEÑO }))
        .set(...TENANT_HEADER)
        .expect(200);

      expect(response.body).toMatchObject({ onboardingStatus: 'under_review' });
      expect(profiles.submit).toHaveBeenCalledTimes(1);
      const [[tenantId, partnerId]] = profiles.submit.mock.calls as unknown as [[string, string]];
      expect(tenantId).toBe('1');
      expect(partnerId).toBe(PARTNER_ID);
    });

    it('un internal_operator (sin :partnerId propio) también puede enviarlo — el guard sólo protege al comercio', async () => {
      await request(app.getHttpServer())
        .post(`/partner-onboarding/${PARTNER_ID}/submit`)
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .expect(200);
    });
  });
});
