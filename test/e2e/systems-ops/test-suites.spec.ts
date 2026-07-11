import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SystemsTestController } from '../../../src/modules/systems-ops/systems-test.controller.js';
import { SystemsTestQueryService } from '../../../src/modules/systems-ops/systems-test-query.service.js';
import { SystemsTestSuiteAdminService } from '../../../src/modules/systems-ops/systems-test-suite-admin.service.js';
import { buildSystemsOpsTestApp, authHeader } from './support/systems-ops-test-app.js';

describe('SystemsTestController (e2e/supertest)', () => {
  let app: INestApplication;
  const service = {
    listTestSuites: jest.fn(async () => ({ items: [], meta: {} })),
    getTestSuite: jest.fn(async () => ({ id: '1', steps: [] })),
    runTestSuite: jest.fn(async () => ({ runId: '1', status: 'QUEUED' })),
    listTestRuns: jest.fn(async () => ({ items: [], meta: {} })),
    getTestRun: jest.fn(async () => ({ id: '1', status: 'PASSED' })),
  };
  const suiteAdminService = {
    createSuite: jest.fn(async () => ({ id: '1' })),
    updateSuite: jest.fn(async () => ({ id: '1' })),
    createStep: jest.fn(async () => ({ id: '1' })),
    updateStep: jest.fn(async () => ({ id: '1' })),
    reorderSteps: jest.fn(async () => ({ reordered: true })),
  };

  beforeAll(async () => {
    app = await buildSystemsOpsTestApp(
      [SystemsTestController],
      [
        { provide: SystemsTestQueryService, useValue: service },
        { provide: SystemsTestSuiteAdminService, useValue: suiteAdminService },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const validSuiteBody = { code: 'RISK_SMOKE_1', name: 'Risk smoke test', module: 'risk' };
  const validStepBody = { stepOrder: 1, name: 'Call risk endpoint', method: 'GET', pathTemplate: '/risk/health' };

  describe('seguridad', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer()).get('/systems/test-suites').expect(401);
    });

    it('rechaza con 403 a readonly_auditor al crear una suite (escritura)', async () => {
      await request(app.getHttpServer())
        .post('/systems/test-suites')
        .set(...authHeader('readonly_auditor'))
        .send(validSuiteBody)
        .expect(403);
      expect(suiteAdminService.createSuite).not.toHaveBeenCalled();
    });
  });

  it('POST /systems/test-suites valida code (regex ^[A-Z0-9_]+$) con 400 si es inválido', async () => {
    await request(app.getHttpServer())
      .post('/systems/test-suites')
      .set(...authHeader('system_admin'))
      .send({ ...validSuiteBody, code: 'not-uppercase' })
      .expect(400);
    expect(suiteAdminService.createSuite).not.toHaveBeenCalled();
  });

  it('POST /systems/test-suites crea la suite y pasa el CurrentUser autenticado', async () => {
    const res = await request(app.getHttpServer())
      .post('/systems/test-suites')
      .set(...authHeader('qa_engineer', { sub: 'qa-7' }))
      .send(validSuiteBody)
      .expect(201);

    expect(res.body).toEqual({ id: '1' });
    expect(suiteAdminService.createSuite).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RISK_SMOKE_1', name: 'Risk smoke test', module: 'risk', suiteType: 'INTEGRATION' }),
      expect.objectContaining({ sub: 'qa-7', role: 'qa_engineer' }),
    );
  });

  it('GET /systems/test-suites/:suiteId delega', async () => {
    await request(app.getHttpServer())
      .get('/systems/test-suites/12')
      .set(...authHeader('readonly_auditor'))
      .expect(200);
    expect(service.getTestSuite).toHaveBeenCalledWith('12');
  });

  /**
   * Regresión: `updateTestSuiteSchema` solía construirse como
   * `createTestSuiteSchema.partial().refine(v => Object.keys(v).length > 0, ...)`. Zod re-aplica
   * `.default()` de cada campo incluso después de `.partial()`, así que un body `{}` producía
   * claves igual (suiteType, environmentScope, isEnabled, requiresSeedData, isSafeForProduction)
   * y el refine de "al menos un campo" nunca se disparaba — peor, esas claves con default
   * llegaban al repositorio (que escribe todo campo `!== undefined`) y sobrescribían en silencio
   * cualquier suite existente. El schema ahora declara cada campo `.optional()` sin `.default()`.
   */
  it('PATCH con body vacío devuelve 400 (el refine "al menos un campo" sí se dispara)', async () => {
    await request(app.getHttpServer())
      .patch('/systems/test-suites/12')
      .set(...authHeader('system_admin'))
      .send({})
      .expect(400);
    expect(suiteAdminService.updateSuite).not.toHaveBeenCalled();
  });

  it('PATCH con un solo campo explícito NO arrastra los demás campos con default() del schema de creación', async () => {
    await request(app.getHttpServer())
      .patch('/systems/test-suites/12')
      .set(...authHeader('system_admin'))
      .send({ isEnabled: false })
      .expect(200);

    // Verdaderamente parcial: solo la clave enviada llega al repositorio.
    expect(suiteAdminService.updateSuite).toHaveBeenCalledWith('12', { isEnabled: false });
  });

  it('POST /systems/test-suites/:suiteId/steps crea un step con defaults del schema', async () => {
    await request(app.getHttpServer())
      .post('/systems/test-suites/12/steps')
      .set(...authHeader('system_admin'))
      .send(validStepBody)
      .expect(201);
    expect(suiteAdminService.createStep).toHaveBeenCalledWith(
      '12',
      expect.objectContaining({
        stepOrder: 1,
        name: 'Call risk endpoint',
        method: 'GET',
        pathTemplate: '/risk/health',
        inputMode: 'DEFAULT',
      }),
    );
  });

  it('POST /systems/test-suites/:suiteId/steps rechaza pathTemplate sin / ni http(s) con 400', async () => {
    await request(app.getHttpServer())
      .post('/systems/test-suites/12/steps')
      .set(...authHeader('system_admin'))
      .send({ ...validStepBody, pathTemplate: 'relative/path' })
      .expect(400);
  });

  it('PATCH de un step con un solo campo NO arrastra los defaults de createTestStepSchema (mismo fix que updateTestSuiteSchema)', async () => {
    await request(app.getHttpServer())
      .patch('/systems/test-suites/12/steps/34')
      .set(...authHeader('system_admin'))
      .send({ name: 'Renombrado' })
      .expect(200);

    expect(suiteAdminService.updateStep).toHaveBeenCalledWith('12', '34', { name: 'Renombrado' });
  });

  it('PATCH de un step con body vacío devuelve 400', async () => {
    await request(app.getHttpServer())
      .patch('/systems/test-suites/12/steps/34')
      .set(...authHeader('system_admin'))
      .send({})
      .expect(400);
    expect(suiteAdminService.updateStep).not.toHaveBeenCalled();
  });

  it('POST /systems/test-suites/:suiteId/steps/reorder valida el array de steps (400 si viene vacío)', async () => {
    await request(app.getHttpServer())
      .post('/systems/test-suites/12/steps/reorder')
      .set(...authHeader('system_admin'))
      .send({ steps: [] })
      .expect(400);
    expect(suiteAdminService.reorderSteps).not.toHaveBeenCalled();
  });

  it('POST /systems/test-suites/:suiteId/steps/reorder delega la lista válida', async () => {
    const steps = [
      { stepId: '1', stepOrder: 2 },
      { stepId: '2', stepOrder: 1 },
    ];
    await request(app.getHttpServer())
      .post('/systems/test-suites/12/steps/reorder')
      .set(...authHeader('system_admin'))
      .send({ steps })
      .expect(201);
    expect(suiteAdminService.reorderSteps).toHaveBeenCalledWith('12', { steps });
  });

  it('POST /systems/test-suites/:suiteId/run aplica defaults (environment=LOCAL, dryRun=true, timeoutMs=10000) y pasa CurrentUser', async () => {
    await request(app.getHttpServer())
      .post('/systems/test-suites/12/run')
      .set(...authHeader('qa_engineer', { sub: 'qa-9' }))
      .send({})
      .expect(201);

    expect(service.runTestSuite).toHaveBeenCalledWith(
      '12',
      expect.objectContaining({ environment: 'LOCAL', dryRun: true, timeoutMs: 10000 }),
      expect.objectContaining({ sub: 'qa-9' }),
    );
  });

  it('GET /systems/test-runs delega con filtros de systemsRunsQuerySchema', async () => {
    await request(app.getHttpServer())
      .get('/systems/test-runs?suiteId=12&status=FAILED&environment=STAGING&page=2&limit=10')
      .set(...authHeader('readonly_auditor'))
      .expect(200);
    expect(service.listTestRuns).toHaveBeenCalledWith(
      expect.objectContaining({ suiteId: '12', status: 'FAILED', environment: 'STAGING', page: 2, limit: 10 }),
      expect.any(Object),
    );
  });

  it('GET /systems/test-runs/:runId delega', async () => {
    await request(app.getHttpServer())
      .get('/systems/test-runs/77')
      .set(...authHeader('readonly_auditor'))
      .expect(200);
    expect(service.getTestRun).toHaveBeenCalledWith('77', expect.any(Object));
  });
});
