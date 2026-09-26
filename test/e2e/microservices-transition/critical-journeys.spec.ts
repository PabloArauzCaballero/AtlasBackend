/**
 * @file AT-052 — contrato HTTP del recorrido crítico (solicitud de crédito) con dos tenants, revocación y replay.
 * @business Un cliente presenta su solicitud y recibe exactamente el mismo cuerpo, códigos y errores
 *   que hoy; el tenant sale del token; un token revocado a mitad del recorrido se detiene en la puerta;
 *   la clave de idempotencia viaja intacta hasta el dueño (que es quien deduplica, ver integración).
 * @system supertest sobre `CreditController` con guards reales y `CreditApplicationService` doble
 *   que responde con la forma real de la fachada (`SubmittedCreditApplication` sin el id interno) y
 *   lanza los mismos errores que la fachada (`toHttpException(denialError(...))`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BankStatementService } from '../../../src/modules/credit/application/bank-statement.service.js';
import { CreditApplicationService } from '../../../src/modules/credit/application/credit-application.service.js';
import { CreditLineService } from '../../../src/modules/credit/application/credit-line.service.js';
import { CreditProductService } from '../../../src/modules/credit/application/credit-product.service.js';
import { denialError } from '../../../src/modules/credit/application/use-cases/submit-credit-application.use-case.js';
import { CreditController } from '../../../src/modules/credit/credit.controller.js';
import { toHttpException } from '../../../src/platform/contracts/application-error.js';
import { bearer, buildJourneyApp, type Revocation } from './support/journey-app.js';

const CUSTOMER_T1 = '501';
const CUSTOMER_T2 = '777';
const SUBMITTED = Object.freeze({
  applicationId: '9001',
  applicationCode: 'CRA-E2E-1',
  customerId: CUSTOMER_T1,
  productCode: 'PROD-1',
  status: 'submitted',
  requestedAmount: '1500.00',
  requestedTermMonths: 6,
  currencyCode: 'BOB',
  submittedAt: '2026-09-12T10:00:00.000Z',
  purposeCode: null,
});
const BODY = { productId: '1', requestedAmount: 1500, requestedTermMonths: 6 };

describe('AT-052 · recorrido crítico por HTTP (contrato)', () => {
  let app: INestApplication;
  let revocation: Revocation;
  const applications = {
    createApplication: jest.fn(async (..._args: unknown[]) => ({ ...SUBMITTED })),
    listByCustomer: jest.fn(async () => ({ items: [] })),
  };

  beforeAll(async () => {
    ({ app, revocation } = await buildJourneyApp(
      [CreditController],
      [
        { provide: CreditApplicationService, useValue: applications },
        { provide: CreditProductService, useValue: { listOfferable: jest.fn(async () => ({ items: [] })) } },
        { provide: CreditLineService, useValue: {} },
        { provide: BankStatementService, useValue: {} },
      ],
    ));
  });
  beforeEach(() => {
    applications.createApplication.mockClear();
    revocation.getCurrentTokenVersion.mockReset();
    revocation.getCurrentTokenVersion.mockImplementation(async () => null);
  });
  afterAll(async () => {
    await app.close();
  });

  const submit = (customerId: string, auth: [string, string], headers: Record<string, string>) =>
    request(app.getHttpServer()).post(`/customers/${customerId}/credit-applications`).set(auth[0], auth[1]).set(headers).send(BODY);

  it('camino permitido: 201 con el cuerpo público exacto (decimales como texto, fechas ISO, sin ids internos)', async () => {
    const response = await submit(CUSTOMER_T1, bearer('customer', { customerId: CUSTOMER_T1, tenantId: '1' }), {
      'x-tenant-id': '1',
      'x-idempotency-key': 'k-1',
    });
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(Object.keys(SUBMITTED).sort());
    expect(response.body).toEqual(SUBMITTED);
    expect(response.body).not.toHaveProperty('eligibilityEvaluationId');
    expect(applications.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '1',
        customerId: CUSTOMER_T1,
        idempotencyKey: 'k-1',
        body: expect.objectContaining({ requestedAmount: 1500 }),
      }),
    );
  });

  it('sin clave de idempotencia: 400 antes de llegar al dueño', async () => {
    const response = await submit(CUSTOMER_T1, bearer('customer', { customerId: CUSTOMER_T1, tenantId: '1' }), { 'x-tenant-id': '1' });
    expect(response.status).toBe(400);
    expect(applications.createApplication).not.toHaveBeenCalled();
  });

  it('denegación: 422 CUSTOMER_NOT_ELIGIBLE con los bloqueadores, mismo formato que la fachada', async () => {
    applications.createApplication.mockImplementationOnce(async () => {
      throw toHttpException(
        denialError({
          eligible: false,
          blockers: [{ code: 'LIFECYCLE_BLOCKED', detail: 'x' }],
          ruleVersion: 'v1',
          lifecycleStatus: 'blocked',
          evaluatedAt: new Date(),
          evaluationId: '1',
        } as never),
      );
    });
    const response = await submit(CUSTOMER_T1, bearer('customer', { customerId: CUSTOMER_T1, tenantId: '1' }), {
      'x-tenant-id': '1',
      'x-idempotency-key': 'k-2',
    });
    expect(response.status).toBe(422);
    expect(response.body.message).toContain('CUSTOMER_NOT_ELIGIBLE');
    expect(JSON.stringify(response.body)).toContain('LIFECYCLE_BLOCKED');
  });

  it('dos tenants: el token del tenant 1 con cabecera del tenant 2 se rechaza (403) sin llamar al dueño', async () => {
    const response = await submit(CUSTOMER_T1, bearer('customer', { customerId: CUSTOMER_T1, tenantId: '1' }), {
      'x-tenant-id': '2',
      'x-idempotency-key': 'k-3',
    });
    expect(response.status).toBe(403);
    expect(applications.createApplication).not.toHaveBeenCalled();
  });

  it('dos tenants: el cliente del tenant 2 no puede presentar por el cliente del tenant 1 (propiedad en el dueño)', async () => {
    // El guard deja pasar (token y cabecera coinciden); la propiedad la comprueba el servicio dueño, que aquí
    // es doble: lo que se fija es que el customerId de la URL y el actor llegan intactos al dueño.
    await submit(CUSTOMER_T1, bearer('customer', { customerId: CUSTOMER_T2, tenantId: '2' }), {
      'x-tenant-id': '2',
      'x-idempotency-key': 'k-4',
    });
    expect(applications.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '2',
        customerId: CUSTOMER_T1,
        currentUser: expect.objectContaining({ customerId: CUSTOMER_T2 }),
      }),
    );
  });

  it('revocación a mitad del recorrido: el token con versión vieja recibe 401 y el dueño no se entera', async () => {
    revocation.getCurrentTokenVersion.mockImplementation(async () => 7);
    const response = await submit(CUSTOMER_T1, bearer('customer', { customerId: CUSTOMER_T1, tenantId: '1', tokenVersion: 6 }), {
      'x-tenant-id': '1',
      'x-idempotency-key': 'k-5',
    });
    expect(response.status).toBe(401);
    expect(applications.createApplication).not.toHaveBeenCalled();
  });

  it('replay: la misma clave llega dos veces al dueño con el mismo valor (la deduplicación es suya, no del borde)', async () => {
    const auth = bearer('customer', { customerId: CUSTOMER_T1, tenantId: '1' });
    await submit(CUSTOMER_T1, auth, { 'x-tenant-id': '1', 'x-idempotency-key': 'k-6' });
    await submit(CUSTOMER_T1, auth, { 'x-tenant-id': '1', 'x-idempotency-key': 'k-6' });
    const keys = applications.createApplication.mock.calls.map((call) => (call[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual(['k-6', 'k-6']);
  });
});
