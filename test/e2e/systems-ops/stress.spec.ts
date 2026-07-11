import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SystemsStressController } from '../../../src/modules/systems-ops/systems-stress.controller.js';
import { SystemsStressProfileService } from '../../../src/modules/systems-ops/systems-stress-profile.service.js';
import { SystemsStressRunService } from '../../../src/modules/systems-ops/systems-stress-run.service.js';
import { buildSystemsOpsTestApp, authHeader } from './support/systems-ops-test-app.js';

describe('SystemsStressController (e2e/supertest)', () => {
  let app: INestApplication;
  const service = {
    listStressProfiles: jest.fn(async () => ({ items: [], meta: {} })),
    getStressProfile: jest.fn(async () => ({ id: '1' })),
    upsertStressProfile: jest.fn(async () => ({ id: '1' })),
    getStressMatrix: jest.fn(async () => ({ items: [], meta: {} })),
  };
  const stressRunService = {
    queueStressRun: jest.fn(async () => ({ runId: '1', status: 'QUEUED' })),
    listStressRuns: jest.fn(async () => ({ items: [], meta: {} })),
  };

  beforeAll(async () => {
    app = await buildSystemsOpsTestApp(
      [SystemsStressController],
      [
        { provide: SystemsStressProfileService, useValue: service },
        { provide: SystemsStressRunService, useValue: stressRunService },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const validProfileBody = {
    endpointId: '1',
    name: 'Login burst',
    targetRps: 50,
    durationSeconds: 60,
    concurrency: 10,
  };

  describe('seguridad', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer()).get('/systems/stress-profiles').expect(401);
    });

    it('rechaza con 403 a readonly_auditor al encolar una corrida de estrés (escritura)', async () => {
      await request(app.getHttpServer())
        .post('/systems/stress-profiles/1/queue-run')
        .set(...authHeader('readonly_auditor'))
        .send({})
        .expect(403);
      expect(stressRunService.queueStressRun).not.toHaveBeenCalled();
    });
  });

  it('GET /systems/stress-profiles/:profileId valida positiveId (400 si no es numérico)', async () => {
    await request(app.getHttpServer())
      .get('/systems/stress-profiles/not-an-id')
      .set(...authHeader('system_admin'))
      .expect(400);
  });

  it('GET /systems/stress-profiles/:profileId delega', async () => {
    await request(app.getHttpServer())
      .get('/systems/stress-profiles/8')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(service.getStressProfile).toHaveBeenCalledWith('8');
  });

  it('POST /systems/stress-profiles/:profileId/queue-run aplica defaults (environment=LOCAL, dryRun=true) y pasa CurrentUser', async () => {
    await request(app.getHttpServer())
      .post('/systems/stress-profiles/8/queue-run')
      .set(...authHeader('devops', { sub: 'devops-1' }))
      .send({})
      .expect(201);

    expect(stressRunService.queueStressRun).toHaveBeenCalledWith(
      '8',
      expect.objectContaining({ environment: 'LOCAL', dryRun: true }),
      expect.objectContaining({ sub: 'devops-1' }),
    );
  });

  it('POST /systems/stress-profiles/:profileId/queue-run rechaza baseUrl inválida con 400', async () => {
    await request(app.getHttpServer())
      .post('/systems/stress-profiles/8/queue-run')
      .set(...authHeader('system_admin'))
      .send({ baseUrl: 'not-a-url' })
      .expect(400);
    expect(stressRunService.queueStressRun).not.toHaveBeenCalled();
  });

  it('POST /systems/stress-profiles crea/actualiza un perfil y pasa CurrentUser', async () => {
    await request(app.getHttpServer())
      .post('/systems/stress-profiles')
      .set(...authHeader('system_admin', { sub: 'admin-1' }))
      .send(validProfileBody)
      .expect(201);

    expect(service.upsertStressProfile).toHaveBeenCalledWith(
      expect.objectContaining({ endpointId: '1', name: 'Login burst', targetRps: 50, durationSeconds: 60, concurrency: 10 }),
      expect.objectContaining({ sub: 'admin-1' }),
    );
  });

  it('POST /systems/stress-profiles rechaza targetRps fuera de rango (>10000) con 400', async () => {
    await request(app.getHttpServer())
      .post('/systems/stress-profiles')
      .set(...authHeader('system_admin'))
      .send({ ...validProfileBody, targetRps: 999999 })
      .expect(400);
    expect(service.upsertStressProfile).not.toHaveBeenCalled();
  });

  it('GET /systems/stress-matrix delega con los filtros de systemsListQuerySchema', async () => {
    await request(app.getHttpServer())
      .get('/systems/stress-matrix?module=risk&page=3&limit=15')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(service.getStressMatrix).toHaveBeenCalledWith(expect.objectContaining({ module: 'risk', page: 3, limit: 15 }));
  });

  it('GET /systems/stress-runs delega con filtros de systemsRunsQuerySchema', async () => {
    await request(app.getHttpServer())
      .get('/systems/stress-runs?suiteId=4&status=RUNNING&environment=STAGING')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(stressRunService.listStressRuns).toHaveBeenCalledWith(
      expect.objectContaining({ suiteId: '4', status: 'RUNNING', environment: 'STAGING' }),
      expect.any(Object),
    );
  });

  it('GET /systems/stress-runs rechaza status fuera del enum con 400', async () => {
    await request(app.getHttpServer())
      .get('/systems/stress-runs?status=BOGUS')
      .set(...authHeader('system_admin'))
      .expect(400);
  });
});
