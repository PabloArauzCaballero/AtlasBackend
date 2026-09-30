import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoansOperationsController } from '../../../src/modules/loans/loans-operations.controller.js';
import { LoanDelinquencyService } from '../../../src/modules/loans/application/loan-delinquency.service.js';
import { OutcomeDispatchService } from '../../../src/modules/decision-engine/outcome-dispatch.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST operations/loans/delinquency-sweep`.
 *
 * Es un barrido operativo sobre la cartera viva de TODO el tenant: no hay un préstamo concreto que
 * fijar como fixture con el que comprobar un desenlace de negocio real, así que —igual que los jobs
 * de expedientes— la suite se detiene en lo que el HTTP demuestra por sí solo: el rol, que el
 * `tenantId` viaja siempre acotado a la sesión (nunca un tenant elegido por el cliente), y la
 * validación del `limit` del cuerpo.
 */
describe('LoansOperationsController (e2e/supertest) — POST operations/loans/delinquency-sweep', () => {
  let app: INestApplication;

  const delinquency = {
    sweep: jest.fn(async (..._args: unknown[]) => ({ evaluated: 0, observationsQueued: 0 })),
  };
  const outcomes = { summarize: jest.fn(), exhausted: jest.fn() };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [LoansOperationsController],
      [
        { provide: LoanDelinquencyService, useValue: delinquency },
        { provide: OutcomeDispatchService, useValue: outcomes },
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
      .post('/operations/loans/delinquency-sweep')
      .set(...TENANT_HEADER)
      .send({})
      .expect(401);
    expect(delinquency.sweep).not.toHaveBeenCalled();
  });

  it('un cliente (customer) NO puede barrer la cartera', async () => {
    await request(app.getHttpServer())
      .post('/operations/loans/delinquency-sweep')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .send({})
      .expect(403);
    expect(delinquency.sweep).not.toHaveBeenCalled();
  });

  it('rechaza un limit fuera de rango (más de 1000)', async () => {
    await request(app.getHttpServer())
      .post('/operations/loans/delinquency-sweep')
      .set(...authHeader('internal_operator'))
      .set(...TENANT_HEADER)
      .send({ limit: 5000 })
      .expect(400);
    expect(delinquency.sweep).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo con campos de más (schema strict)', async () => {
    await request(app.getHttpServer())
      .post('/operations/loans/delinquency-sweep')
      .set(...authHeader('internal_operator'))
      .set(...TENANT_HEADER)
      .send({ limit: 50, tenantId: '2' })
      .expect(400);
    expect(delinquency.sweep).not.toHaveBeenCalled();
  });

  it('un operador interno dispara el barrido acotado a su tenant y recibe 200', async () => {
    const response = await request(app.getHttpServer())
      .post('/operations/loans/delinquency-sweep')
      .set(...authHeader('internal_operator'))
      .set(...TENANT_HEADER)
      .send({ limit: 50 })
      .expect(200);

    expect(response.body).toMatchObject({ evaluated: 0 });
    const [[input]] = delinquency.sweep.mock.calls as unknown as [[{ tenantId: string; limit: number }]];
    expect(input.tenantId).toBe('1');
    expect(input.limit).toBe(50);
  });
});
