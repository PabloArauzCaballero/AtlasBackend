import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MobilePaymentClaimsController } from '../../../src/modules/loan-payment-claims/mobile-payment-claims.controller.js';
import { LoanPaymentClaimsService } from '../../../src/modules/loan-payment-claims/loan-payment-claims.service.js';
import { PaymentInstructionService } from '../../../src/modules/loan-payment-claims/payment-instruction.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST mobile/customers/:customerId/payment-claims/proof-tickets`.
 *
 * Quien pide el permiso para subir el comprobante es el propio cliente desde su teléfono. El
 * controlador no compara `:customerId` contra el token —lo hace el servicio, que está simulado
 * aquí—, así que esta suite fija lo que el HTTP sí decide: el rol de la clase
 * (`customer`, `internal_operator`, `admin`, `platform_admin`) y la validación del cuerpo.
 */
describe('MobilePaymentClaimsController (e2e/supertest) — POST .../payment-claims/proof-tickets', () => {
  let app: INestApplication;

  const claims = {
    createProofTicket: jest.fn(async (..._args: unknown[]) => ({ uploadUrl: 'https://minio.local/put', storageKey: 'claims/1/a.jpg' })),
    submit: jest.fn(async (..._args: unknown[]) => ({ claimId: '1', status: 'pending' })),
  };
  const instructions = {
    paymentInstruction: jest.fn(async (..._args: unknown[]) => ({
      amount: '100.00',
      beneficiary: 'Comercio X',
      qr: 'data:image/png;base64,AA==',
    })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [MobilePaymentClaimsController],
      [
        { provide: LoanPaymentClaimsService, useValue: claims },
        { provide: PaymentInstructionService, useValue: instructions },
      ],
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
      .post('/mobile/customers/77/payment-claims/proof-tickets')
      .set(...TENANT_HEADER)
      .send({ contentType: 'image/jpeg', sizeBytes: 1000 })
      .expect(401);
    expect(claims.createProofTicket).not.toHaveBeenCalled();
  });

  it('un rol sin acceso (merchant) NO puede pedir el ticket de subida', async () => {
    await request(app.getHttpServer())
      .post('/mobile/customers/77/payment-claims/proof-tickets')
      .set(...authHeader('merchant'))
      .set(...TENANT_HEADER)
      .send({ contentType: 'image/jpeg', sizeBytes: 1000 })
      .expect(403);
    expect(claims.createProofTicket).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo sin contentType/sizeBytes válidos', async () => {
    await request(app.getHttpServer())
      .post('/mobile/customers/77/payment-claims/proof-tickets')
      .set(...authHeader('customer', { customerId: '77' }))
      .set(...TENANT_HEADER)
      .send({ contentType: 'im', sizeBytes: -1 })
      .expect(400);
    expect(claims.createProofTicket).not.toHaveBeenCalled();
  });

  it('el cliente pide el ticket de subida para su propio expediente y recibe 201', async () => {
    const response = await request(app.getHttpServer())
      .post('/mobile/customers/77/payment-claims/proof-tickets')
      .set(...authHeader('customer', { customerId: '77' }))
      .set(...TENANT_HEADER)
      .send({ contentType: 'image/jpeg', sizeBytes: 250_000 })
      .expect(201);

    expect(response.body).toMatchObject({ storageKey: 'claims/1/a.jpg' });
    const [[input]] = claims.createProofTicket.mock.calls as unknown as [[{ tenantId: string; customerId: string }]];
    expect(input.tenantId).toBe('1');
    expect(input.customerId).toBe('77');
  });
});
