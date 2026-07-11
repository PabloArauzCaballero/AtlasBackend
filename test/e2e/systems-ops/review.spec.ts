import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SystemsReviewController } from '../../../src/modules/systems-ops/systems-review.controller.js';
import { SystemsReviewService } from '../../../src/modules/systems-ops/systems-review.service.js';
import { buildSystemsOpsTestApp, authHeader } from './support/systems-ops-test-app.js';

describe('SystemsReviewController (e2e/supertest)', () => {
  let app: INestApplication;
  const service = {
    getReviewQueue: jest.fn(async () => ({ items: [], meta: {} })),
    reviewEndpoint: jest.fn(async () => ({ id: '1', reviewStatus: 'APPROVED' })),
    reviewToolRequirement: jest.fn(async () => ({ id: '1', reviewStatus: 'APPROVED' })),
    reviewDataEntity: jest.fn(async () => ({ id: '1', reviewStatus: 'APPROVED' })),
    reviewDataImpact: jest.fn(async () => ({ id: '1', reviewStatus: 'APPROVED' })),
    reviewFieldImpact: jest.fn(async () => ({ id: '1', reviewStatus: 'APPROVED' })),
    reviewDataColumn: jest.fn(async () => ({ id: '1', reviewStatus: 'APPROVED' })),
  };

  beforeAll(async () => {
    app = await buildSystemsOpsTestApp([SystemsReviewController], [{ provide: SystemsReviewService, useValue: service }]);
  });

  afterAll(async () => {
    await app.close();
  });

  const validDecision = { reviewStatus: 'APPROVED', confidenceLevel: 'HIGH', notes: 'ok' };

  describe('seguridad', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer()).get('/systems/review-queue').expect(401);
    });

    it('rechaza con 403 a readonly_auditor en un PATCH de revisión (es una escritura)', async () => {
      await request(app.getHttpServer())
        .patch('/systems/endpoints/1/review')
        .set(...authHeader('readonly_auditor'))
        .send(validDecision)
        .expect(403);
      expect(service.reviewEndpoint).not.toHaveBeenCalled();
    });

    it('permite a readonly_auditor leer la cola de revisión (endpoint de solo lectura)', async () => {
      await request(app.getHttpServer())
        .get('/systems/review-queue')
        .set(...authHeader('readonly_auditor'))
        .expect(200);
    });
  });

  it('GET /systems/review-queue aplica defaults del schema (type=all, reviewStatus=NEEDS_REVIEW)', async () => {
    await request(app.getHttpServer())
      .get('/systems/review-queue')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(service.getReviewQueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'all', reviewStatus: 'NEEDS_REVIEW', page: 1, limit: 20 }),
    );
  });

  it('PATCH /systems/endpoints/:endpointId/review valida el body con reviewDecisionSchema (400 si reviewStatus es inválido)', async () => {
    await request(app.getHttpServer())
      .patch('/systems/endpoints/1/review')
      .set(...authHeader('system_admin'))
      .send({ reviewStatus: 'MAYBE' })
      .expect(400);
    expect(service.reviewEndpoint).not.toHaveBeenCalled();
  });

  it('PATCH /systems/endpoints/:endpointId/review pasa el CurrentUser autenticado al service', async () => {
    await request(app.getHttpServer())
      .patch('/systems/endpoints/55/review')
      .set(...authHeader('system_admin', { sub: 'admin-42' }))
      .send(validDecision)
      .expect(200);

    expect(service.reviewEndpoint).toHaveBeenCalledWith(
      '55',
      validDecision,
      expect.objectContaining({ sub: 'admin-42', role: 'system_admin' }),
    );
  });

  it('PATCH /systems/tools/requirements/:requirementId/review delega con CurrentUser', async () => {
    await request(app.getHttpServer())
      .patch('/systems/tools/requirements/9/review')
      .set(...authHeader('system_admin'))
      .send(validDecision)
      .expect(200);
    expect(service.reviewToolRequirement).toHaveBeenCalledWith('9', validDecision, expect.any(Object));
  });

  it('PATCH /systems/data-entities/:entityId/review delega', async () => {
    await request(app.getHttpServer())
      .patch('/systems/data-entities/9/review')
      .set(...authHeader('system_admin'))
      .send(validDecision)
      .expect(200);
    expect(service.reviewDataEntity).toHaveBeenCalledWith('9', validDecision, expect.any(Object));
  });

  it('PATCH /systems/impact/data/:impactId/review delega', async () => {
    await request(app.getHttpServer())
      .patch('/systems/impact/data/9/review')
      .set(...authHeader('system_admin'))
      .send(validDecision)
      .expect(200);
    expect(service.reviewDataImpact).toHaveBeenCalledWith('9', validDecision, expect.any(Object));
  });

  it('PATCH /systems/impact/fields/:fieldImpactId/review delega', async () => {
    await request(app.getHttpServer())
      .patch('/systems/impact/fields/9/review')
      .set(...authHeader('system_admin'))
      .send(validDecision)
      .expect(200);
    expect(service.reviewFieldImpact).toHaveBeenCalledWith('9', validDecision, expect.any(Object));
  });

  it('PATCH /systems/data-entities/columns/:columnId/review delega', async () => {
    await request(app.getHttpServer())
      .patch('/systems/data-entities/columns/9/review')
      .set(...authHeader('system_admin'))
      .send(validDecision)
      .expect(200);
    expect(service.reviewDataColumn).toHaveBeenCalledWith('9', validDecision, expect.any(Object));
  });
});
