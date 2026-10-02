import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ErpDocumentsController } from '../../../src/modules/partner-onboarding/erp-documents.controller.js';
import { ErpMerchantExpedienteService } from '../../../src/modules/partner-onboarding/application/erp-merchant-expediente.service.js';
import { ErpDocumentsService } from '../../../src/modules/partner-onboarding/application/erp-documents.service.js';
import { PartnerQrService } from '../../../src/modules/partner-onboarding/application/partner-qr.service.js';
import { PartnerRepresentativeService } from '../../../src/modules/partner-onboarding/application/partner-representative.service.js';
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

  const qrService = {
    createUploadTicket: jest.fn(async (..._args: unknown[]) => ({
      uploadUrl: 'https://storage.example/put-qr',
      storageKey: '1/partner-7/qr-bank/1700000000.png',
      expiresAt: '2026-10-02T00:05:00.000Z',
    })),
  };
  const representativeService = {
    createDocumentUploadTicket: jest.fn((..._args: unknown[]) => ({
      uploadUrl: 'https://storage.example/put-poder',
      storageKey: '1/partner-7/power-of-attorney/1700000000.pdf',
      expiresAt: '2026-10-02T00:05:00.000Z',
    })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [ErpDocumentsController],
      [
        { provide: ErpDocumentsService, useValue: documentsService },
        { provide: ErpMerchantExpedienteService, useValue: { asegurar: jest.fn() } },
        { provide: PartnerQrService, useValue: qrService },
        { provide: PartnerRepresentativeService, useValue: representativeService },
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

  /*
   * El permiso de subida DENTRO de la carpeta del comercio (poder y QR capturados en el alta del ERP):
   * misma frontera de roles que el resto del controlador, y el tipo decide qué servicio emite el permiso.
   */
  describe('merchant-expediente/:partnerId/upload-url', () => {
    it('un merchant no puede pedirlo: es el ERP (personal interno) quien carga lo del alta', async () => {
      await request(app.getHttpServer())
        .post('/operations/erp-documents/merchant-expediente/7/upload-url')
        .set(...authHeader('merchant'))
        .set(...TENANT_HEADER)
        .send({ documentKind: 'bank-qr', contentType: 'image/png', sizeBytes: 1024 })
        .expect(403);
    });

    it('un QR en PDF se rechaza en el borde: un QR es una imagen', async () => {
      await request(app.getHttpServer())
        .post('/operations/erp-documents/merchant-expediente/7/upload-url')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({ documentKind: 'bank-qr', contentType: 'application/pdf', sizeBytes: 1024 })
        .expect(400);
    });

    it('el QR va al servicio de QR y el poder al de representantes, con el tenant de la cabecera', async () => {
      const qr = await request(app.getHttpServer())
        .post('/operations/erp-documents/merchant-expediente/7/upload-url')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({ documentKind: 'bank-qr', contentType: 'image/png', sizeBytes: 1024 })
        .expect(201);
      expect(qr.body).toMatchObject({ storageKey: expect.stringContaining('/partner-7/qr-bank/') });
      expect(qrService.createUploadTicket).toHaveBeenCalledWith('1', '7', { qrKind: 'bank', contentType: 'image/png', sizeBytes: 1024 });

      const poder = await request(app.getHttpServer())
        .post('/operations/erp-documents/merchant-expediente/7/upload-url')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({ documentKind: 'power-of-attorney', contentType: 'application/pdf', sizeBytes: 2048 })
        .expect(201);
      expect(poder.body).toMatchObject({ storageKey: expect.stringContaining('/power-of-attorney/') });
      expect(representativeService.createDocumentUploadTicket).toHaveBeenCalledWith('1', '7', {
        documentKind: 'power-of-attorney',
        contentType: 'application/pdf',
        sizeBytes: 2048,
      });
    });
  });
});
