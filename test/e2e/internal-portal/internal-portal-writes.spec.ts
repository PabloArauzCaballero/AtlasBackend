import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { InternalPortalController } from '../../../src/modules/internal-portal/internal-portal.controller.js';
import { InternalPortalService } from '../../../src/modules/internal-portal/internal-portal.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de las dos únicas rutas de escritura del portal interno: reconocer una alerta
 * (`POST /internal/alerts/:alertId/acknowledge`) y computar un reporte bajo demanda
 * (`POST /internal/reports/:reportId/run`). Señaladas UNTESTED_WRITE: no había ningún test que
 * nombrara estas rutas HTTP exactas ni pasara por los guards reales (`@Roles` se aplica a nivel de
 * CLASE en este controller, no hay override por método en estas dos rutas).
 */
describe('InternalPortalController (e2e/supertest) — rutas de escritura', () => {
  let app: INestApplication;

  const service = {
    listBusinessTerms: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    getBusinessTerm: jest.fn(async (..._args: unknown[]) => ({})),
    listExports: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    getExport: jest.fn(async (..._args: unknown[]) => ({})),
    listDataQualityRules: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    getDataQualityRule: jest.fn(async (..._args: unknown[]) => ({})),
    getGovernancePolicy: jest.fn(async (..._args: unknown[]) => ({})),
    getLineage: jest.fn(async (..._args: unknown[]) => ({ nodes: [], edges: [] })),
    getLineageNode: jest.fn(async (..._args: unknown[]) => ({})),
    getLineageImpact: jest.fn(async (..._args: unknown[]) => ({})),
    listAlerts: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    acknowledgeAlert: jest.fn(async (..._args: unknown[]) => ({ status: 'acknowledged' })),
    listJobs: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    getJob: jest.fn(async (..._args: unknown[]) => ({})),
    getReleaseReadiness: jest.fn(async (..._args: unknown[]) => ({})),
    listReports: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    getReport: jest.fn(async (..._args: unknown[]) => ({})),
    runReport: jest.fn(async (..._args: unknown[]) => ({ persisted: false, data: {} })),
    search: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp([InternalPortalController], [{ provide: InternalPortalService, useValue: service }]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /internal/alerts/:alertId/acknowledge', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/internal/alerts/dq:103/acknowledge')
        .set(...TENANT_HEADER)
        .send({})
        .expect(401);
      expect(service.acknowledgeAlert).not.toHaveBeenCalled();
    });

    it('rechaza con 403 a un rol ajeno al portal interno (customer)', async () => {
      await request(app.getHttpServer())
        .post('/internal/alerts/dq:103/acknowledge')
        .set(...authHeader('customer'))
        .set(...TENANT_HEADER)
        .send({})
        .expect(403);
      expect(service.acknowledgeAlert).not.toHaveBeenCalled();
    });

    it('un operador interno reconoce la alerta y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/internal/alerts/dq:103/acknowledge')
        .set(...authHeader('internal_operator', { tenantId: '1' }))
        .set(...TENANT_HEADER)
        .send({})
        .expect(200);

      expect(response.body).toEqual({ status: 'acknowledged' });
      expect(service.acknowledgeAlert).toHaveBeenCalledWith(expect.anything(), 'dq:103');
    });
  });

  describe('POST /internal/reports/:reportId/run', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/internal/reports/portfolio-summary/run')
        .set(...TENANT_HEADER)
        .send({})
        .expect(401);
      expect(service.runReport).not.toHaveBeenCalled();
    });

    it('rechaza con 403 a un rol ajeno al portal interno (customer)', async () => {
      await request(app.getHttpServer())
        .post('/internal/reports/portfolio-summary/run')
        .set(...authHeader('customer'))
        .set(...TENANT_HEADER)
        .send({})
        .expect(403);
      expect(service.runReport).not.toHaveBeenCalled();
    });

    it('un cuerpo con `filters` que no es objeto plano se rechaza con 400', async () => {
      await request(app.getHttpServer())
        .post('/internal/reports/portfolio-summary/run')
        .set(...authHeader('risk_analyst', { tenantId: '1' }))
        .set(...TENANT_HEADER)
        .send({ filters: 'no-soy-un-objeto' })
        .expect(400);
      expect(service.runReport).not.toHaveBeenCalled();
    });

    it('un analista de riesgo computa el reporte en vivo y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/internal/reports/portfolio-summary/run')
        .set(...authHeader('risk_analyst', { tenantId: '1' }))
        .set(...TENANT_HEADER)
        .send({ filters: { branch: 'la-paz' } })
        .expect(200);

      expect(response.body).toEqual({ persisted: false, data: {} });
      expect(service.runReport).toHaveBeenCalledWith(expect.anything(), 'portfolio-summary', { filters: { branch: 'la-paz' } });
    });
  });
});
