import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ErpDocumentsController } from '../../../src/modules/partner-onboarding/erp-documents.controller.js';
import { ErpMerchantExpedienteService } from '../../../src/modules/partner-onboarding/application/erp-merchant-expediente.service.js';
import { ErpDocumentsService } from '../../../src/modules/partner-onboarding/application/erp-documents.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST operations/erp-documents/upload-url`.
 *
 * Todo el controlador es `@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin',
 * 'platform_admin')` a nivel de clase: llega con el token interno del ERP, nunca con el de un
 * comercio. Un `merchant` pidiendo un permiso de subida acá sería el mismo agujero que el hallazgo
 * de propiedad de `PartnerOwnershipGuard` — subir documentos ajenos bajo un prefijo que no le
 * corresponde.
 */
describe('ErpDocumentsController — upload-url (e2e/supertest)', () => {
  let app: INestApplication;

  const documentsService = {
    createUploadTicket: jest.fn(async (..._args: unknown[]) => ({
      uploadUrl: 'https://storage.example/put',
      storageKey: '1/erp-b2b-account-55/kyb-1700000000.pdf',
      expiresAt: '2026-09-30T00:05:00.000Z',
    })),
    verify: jest.fn(async (..._args: unknown[]) => ({ sizeBytes: 10, sha256Hex: 'a'.repeat(64), contentType: 'application/pdf' })),
    read: jest.fn(async (..._args: unknown[]) => ({ bytes: Buffer.from('x'), contentType: 'application/pdf' })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [ErpDocumentsController],
      [
        { provide: ErpDocumentsService, useValue: documentsService },
        { provide: ErpMerchantExpedienteService, useValue: { ensureExpediente: jest.fn() } },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const validBody = {
    ownerType: 'b2b-account',
    ownerId: '55',
    documentKind: 'kyb',
    contentType: 'application/pdf',
    sizeBytes: 1024,
  };

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/operations/erp-documents/upload-url')
      .set(...TENANT_HEADER)
      .send(validBody)
      .expect(401);
    expect(documentsService.createUploadTicket).not.toHaveBeenCalled();
  });

  it('un merchant NO puede pedir el permiso de subida — es una ruta de personal interno del ERP', async () => {
    await request(app.getHttpServer())
      .post('/operations/erp-documents/upload-url')
      .set(...authHeader('merchant'))
      .set(...TENANT_HEADER)
      .send(validBody)
      .expect(403);
    expect(documentsService.createUploadTicket).not.toHaveBeenCalled();
  });

  it('un customer tampoco puede pedirlo', async () => {
    await request(app.getHttpServer())
      .post('/operations/erp-documents/upload-url')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .send(validBody)
      .expect(403);
    expect(documentsService.createUploadTicket).not.toHaveBeenCalled();
  });

  it('un tipo de contenido fuera del catálogo se rechaza en el borde (400)', async () => {
    await request(app.getHttpServer())
      .post('/operations/erp-documents/upload-url')
      .set(...authHeader('internal_operator'))
      .set(...TENANT_HEADER)
      .send({ ...validBody, contentType: 'application/x-msdownload' })
      .expect(400);
    expect(documentsService.createUploadTicket).not.toHaveBeenCalled();
  });

  it('un internal_operator obtiene el permiso de subida (201)', async () => {
    const response = await request(app.getHttpServer())
      .post('/operations/erp-documents/upload-url')
      .set(...authHeader('internal_operator'))
      .set(...TENANT_HEADER)
      .send(validBody)
      .expect(201);

    expect(response.body).toMatchObject({ storageKey: expect.stringContaining('erp-') });
    expect(documentsService.createUploadTicket).toHaveBeenCalledTimes(1);
    const [[input]] = documentsService.createUploadTicket.mock.calls as unknown as [[{ tenantId: string; ownerId: string }]];
    expect(input.tenantId).toBe('1');
    expect(input.ownerId).toBe('55');
  });
});
