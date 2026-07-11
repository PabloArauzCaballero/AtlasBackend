import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SystemsActionLogController } from '../../../src/modules/systems-ops/systems-action-log.controller.js';
import { SystemsActionLogQueryService } from '../../../src/modules/systems-ops/systems-action-log-query.service.js';
import { buildSystemsOpsTestApp, authHeader } from './support/systems-ops-test-app.js';

/**
 * Tests HTTP end-to-end (Supertest) del `SystemsActionLogController`. Complementan a los tests
 * unitarios existentes (que llaman al service directamente): aquí se ejercen guards reales
 * (JwtAuthGuard/RolesGuard), el ZodValidationPipe por parámetro, y el routing de Express, con el
 * `SystemsActionLogQueryService` mockeado como única frontera.
 *
 * La app Nest se levanta una sola vez en `beforeAll` (no en cada test): `clearMocks: true` en
 * jest.config.cjs ya limpia el historial de llamadas de cada mock antes de cada test, así que no
 * hace falta pagar el costo de un `app.init()` por test.
 */
describe('SystemsActionLogController (e2e/supertest)', () => {
  let app: INestApplication;
  const service = {
    listActionLogs: jest.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0 } })),
    getActionLogsByRequest: jest.fn(async () => ({ items: [] })),
    getTrafficLatencyReport: jest.fn(async () => ({ windowHours: 24, summary: {}, routes: [] })),
    getTrafficLatencyTimeseries: jest.fn(async () => ({ windowHours: 24, bucketMinutes: 30, buckets: [] })),
  };

  beforeAll(async () => {
    app = await buildSystemsOpsTestApp([SystemsActionLogController], [{ provide: SystemsActionLogQueryService, useValue: service }]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('seguridad', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer()).get('/systems/action-logs').expect(401);
      expect(service.listActionLogs).not.toHaveBeenCalled();
    });

    it('rechaza con 401 con un token con firma inválida', async () => {
      await request(app.getHttpServer()).get('/systems/action-logs').set('Authorization', 'Bearer not-a-real-jwt').expect(401);
    });

    it('rechaza con 403 a un rol fuera de SYSTEMS_OPS_ROLES (p. ej. customer)', async () => {
      await request(app.getHttpServer())
        .get('/systems/action-logs')
        .set(...authHeader('customer'))
        .expect(403);
      expect(service.listActionLogs).not.toHaveBeenCalled();
    });

    it('permite el acceso de solo lectura a readonly_auditor (no es un endpoint de escritura)', async () => {
      await request(app.getHttpServer())
        .get('/systems/action-logs')
        .set(...authHeader('readonly_auditor'))
        .expect(200);
    });
  });

  describe('GET /systems/action-logs', () => {
    it('valida query params inválidos con 400 (statusCode fuera de rango)', async () => {
      const res = await request(app.getHttpServer())
        .get('/systems/action-logs?statusCode=999')
        .set(...authHeader('system_admin'))
        .expect(400);
      expect(res.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'statusCode' })]));
      expect(service.listActionLogs).not.toHaveBeenCalled();
    });

    it('aplica defaults de paginación y delega al service', async () => {
      const payload = { items: [{ id: '1' }], meta: { page: 1, limit: 20, total: 1 } };
      service.listActionLogs.mockResolvedValueOnce(payload);

      const res = await request(app.getHttpServer())
        .get('/systems/action-logs')
        .set(...authHeader('qa_engineer'))
        .expect(200);

      expect(res.body).toEqual(payload);
      expect(service.listActionLogs).toHaveBeenCalledTimes(1);
      expect(service.listActionLogs.mock.calls[0][0]).toMatchObject({ page: 1, limit: 20 });
    });

    it('propaga filtros explícitos al service (method, riskLevel, page, limit)', async () => {
      await request(app.getHttpServer())
        .get('/systems/action-logs?method=POST&riskLevel=HIGH&page=2&limit=5')
        .set(...authHeader('system_admin'))
        .expect(200);

      expect(service.listActionLogs.mock.calls[0][0]).toMatchObject({
        method: 'POST',
        riskLevel: 'HIGH',
        page: 2,
        limit: 5,
      });
    });
  });

  describe('GET /systems/action-logs/request/:requestId y /by-request/:requestId (alias)', () => {
    it('ambas rutas delegan a getActionLogsByRequest con el mismo requestId', async () => {
      const payload = { items: [{ id: '7', requestId: 'req-123' }] };
      service.getActionLogsByRequest.mockResolvedValue(payload);

      const alias = await request(app.getHttpServer())
        .get('/systems/action-logs/request/req-123')
        .set(...authHeader('devops'))
        .expect(200);
      const canonical = await request(app.getHttpServer())
        .get('/systems/action-logs/by-request/req-123')
        .set(...authHeader('devops'))
        .expect(200);

      expect(alias.body).toEqual(payload);
      expect(canonical.body).toEqual(payload);
      expect(service.getActionLogsByRequest).toHaveBeenNthCalledWith(1, 'req-123', expect.any(Object));
      expect(service.getActionLogsByRequest).toHaveBeenNthCalledWith(2, 'req-123', expect.any(Object));
    });
  });

  describe('GET /systems/reports/traffic-latency', () => {
    it('usa windowHours=24 por defecto', async () => {
      await request(app.getHttpServer())
        .get('/systems/reports/traffic-latency')
        .set(...authHeader('risk_analyst'))
        .expect(200);
      expect(service.getTrafficLatencyReport).toHaveBeenCalledWith(24, expect.any(Object));
    });

    it('rechaza windowHours por encima del máximo (24*30) con 400', async () => {
      await request(app.getHttpServer())
        .get('/systems/reports/traffic-latency?windowHours=99999')
        .set(...authHeader('system_admin'))
        .expect(400);
    });
  });

  describe('GET /systems/reports/traffic-latency-timeseries (endpoint nuevo)', () => {
    it('usa windowHours=24 por defecto y devuelve el payload del service tal cual', async () => {
      const payload = {
        windowHours: 24,
        bucketMinutes: 30,
        buckets: [{ bucketStart: '2026-07-11T00:00:00.000Z', totalRequests: 10, avgLatencyMs: 120, p95LatencyMs: 250, errorRate: 0 }],
      };
      service.getTrafficLatencyTimeseries.mockResolvedValueOnce(payload);

      const res = await request(app.getHttpServer())
        .get('/systems/reports/traffic-latency-timeseries')
        .set(...authHeader('compliance_analyst'))
        .expect(200);

      expect(res.body).toEqual(payload);
      expect(service.getTrafficLatencyTimeseries).toHaveBeenCalledWith(24, expect.any(Object));
    });

    it('propaga windowHours explícito', async () => {
      await request(app.getHttpServer())
        .get('/systems/reports/traffic-latency-timeseries?windowHours=6')
        .set(...authHeader('system_admin'))
        .expect(200);
      expect(service.getTrafficLatencyTimeseries).toHaveBeenCalledWith(6, expect.any(Object));
    });

    it('rechaza windowHours por encima del máximo propio (24*7, distinto del reporte no-timeseries) con 400', async () => {
      await request(app.getHttpServer())
        .get('/systems/reports/traffic-latency-timeseries?windowHours=200')
        .set(...authHeader('system_admin'))
        .expect(400);
      expect(service.getTrafficLatencyTimeseries).not.toHaveBeenCalled();
    });

    it('rechaza windowHours no numérico con 400', async () => {
      await request(app.getHttpServer())
        .get('/systems/reports/traffic-latency-timeseries?windowHours=not-a-number')
        .set(...authHeader('system_admin'))
        .expect(400);
    });
  });
});
