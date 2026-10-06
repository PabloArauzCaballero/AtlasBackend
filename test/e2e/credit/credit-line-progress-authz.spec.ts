import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CreditController } from '../../../src/modules/credit/credit.controller.js';
import { CreditProgressController } from '../../../src/modules/credit/credit-progress.controller.js';
import { BankStatementService } from '../../../src/modules/credit/application/bank-statement.service.js';
import { CreditApplicationService } from '../../../src/modules/credit/application/credit-application.service.js';
import { CreditLineService } from '../../../src/modules/credit/application/credit-line.service.js';
import { CreditProductService } from '../../../src/modules/credit/application/credit-product.service.js';
import { CreditProgressService } from '../../../src/modules/credit/application/credit-progress.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Matriz de autorización negativa de lo que pinta Inicio: `GET customers/:id/credit-line` (el crédito habilitado que
 * decidió el motor) y `GET customers/:id/progress` (Puntaje y Calificación). Sin token, otro cliente, rol sin permiso y
 * otro tenant no reciben nada y el servicio ni se llama.
 */
describe('Crédito habilitado y progreso: autorización (e2e/supertest)', () => {
  let app: INestApplication;
  const creditLines = { requireCurrent: jest.fn(async (..._a: unknown[]) => ({})) };
  const progress = { get: jest.fn(async (..._a: unknown[]) => ({ customerId: '77', rating: { value: 50, scale: { min: 1, max: 100 } } })) };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [CreditController, CreditProgressController],
      [
        { provide: CreditProductService, useValue: {} },
        { provide: CreditApplicationService, useValue: {} },
        { provide: BankStatementService, useValue: {} },
        { provide: CreditLineService, useValue: creditLines },
        { provide: CreditProgressService, useValue: progress },
      ],
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each([
    ['/customers/77/credit-line', () => creditLines.requireCurrent],
    ['/customers/77/progress', () => progress.get],
  ])('GET %s', (ruta, servicio) => {
    it('sin token → 401', async () => {
      await request(app.getHttpServer())
        .get(ruta)
        .set(...TENANT_HEADER)
        .expect(401);
      expect(servicio()).not.toHaveBeenCalled();
    });

    it('otro cliente → 403', async () => {
      await request(app.getHttpServer())
        .get(ruta)
        .set(...authHeader('customer', { customerId: '99' }))
        .set(...TENANT_HEADER)
        .expect(403);
      expect(servicio()).not.toHaveBeenCalled();
    });

    it('rol sin permiso (comercio) → 403', async () => {
      await request(app.getHttpServer())
        .get(ruta)
        .set(...authHeader('merchant'))
        .set(...TENANT_HEADER)
        .expect(403);
      expect(servicio()).not.toHaveBeenCalled();
    });

    it('cliente que pide otro tenant por cabecera → rechazado', async () => {
      const r = await request(app.getHttpServer())
        .get(ruta)
        .set(...authHeader('customer', { customerId: '77', tenantId: '1' }))
        .set('x-tenant-id', '2');
      expect([401, 403]).toContain(r.status);
      expect(servicio()).not.toHaveBeenCalled();
    });

    it('el propio cliente → 200', async () => {
      await request(app.getHttpServer())
        .get(ruta)
        .set(...authHeader('customer', { customerId: '77' }))
        .set(...TENANT_HEADER)
        .expect(200);
      expect(servicio()).toHaveBeenCalledWith('1', '77');
    });
  });
});
