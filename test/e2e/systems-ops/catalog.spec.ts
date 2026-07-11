import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SystemsCatalogController } from '../../../src/modules/systems-ops/systems-catalog.controller.js';
import { SystemsCatalogQueryService } from '../../../src/modules/systems-ops/systems-catalog-query.service.js';
import { SystemsToolInferenceService } from '../../../src/modules/systems-ops/systems-tool-inference.service.js';
import { SystemsDataImpactInferenceService } from '../../../src/modules/systems-ops/systems-data-impact-inference.service.js';
import { buildSystemsOpsTestApp, authHeader } from './support/systems-ops-test-app.js';

describe('SystemsCatalogController (e2e/supertest)', () => {
  let app: INestApplication;
  const service = {
    getDashboard: jest.fn(async () => ({ endpoints: 0, tools: 0 })),
    listEndpoints: jest.fn(async () => ({ items: [], meta: {} })),
    getEndpoint: jest.fn(async () => ({ id: '1' })),
    discoverEndpoints: jest.fn(async () => ({ discovered: 0 })),
    refreshCatalogSeed: jest.fn(async () => ({ refreshed: true })),
    listTools: jest.fn(async () => ({ items: [], meta: {} })),
    getTool: jest.fn(async () => ({ id: '1' })),
    listDataEntities: jest.fn(async () => ({ items: [], meta: {} })),
    getDataEntity: jest.fn(async () => ({ id: '1' })),
    updateDataEntityMetadata: jest.fn(async () => ({ id: '1', metadata: {} })),
    getImpactByEndpoint: jest.fn(async () => ({ endpointId: '1' })),
    getImpactByTable: jest.fn(async () => ({ schemaName: 'public', tableName: 'x' })),
    getToolsHealth: jest.fn(async () => ({ tools: [] })),
    listDomains: jest.fn(async () => ({ items: [], meta: {} })),
    getDomain: jest.fn(async () => ({ domainCode: 'RISK' })),
  };
  const toolInferenceService = { infer: jest.fn(async () => ({ inferred: 0 })) };
  const dataImpactInferenceService = { infer: jest.fn(async () => ({ inferred: 0 })) };

  beforeAll(async () => {
    app = await buildSystemsOpsTestApp(
      [SystemsCatalogController],
      [
        { provide: SystemsCatalogQueryService, useValue: service },
        { provide: SystemsToolInferenceService, useValue: toolInferenceService },
        { provide: SystemsDataImpactInferenceService, useValue: dataImpactInferenceService },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('seguridad', () => {
    it('rechaza con 401 sin token en un endpoint de lectura', async () => {
      await request(app.getHttpServer()).get('/systems/dashboard').expect(401);
    });

    it('rechaza con 403 un POST de escritura para readonly_auditor (excluido de SYSTEMS_OPS_WRITE_ROLES)', async () => {
      await request(app.getHttpServer())
        .post('/systems/endpoints/discover')
        .set(...authHeader('readonly_auditor'))
        .send({})
        .expect(403);
      expect(service.discoverEndpoints).not.toHaveBeenCalled();
    });

    it('permite un POST de escritura para system_admin', async () => {
      await request(app.getHttpServer())
        .post('/systems/endpoints/discover')
        .set(...authHeader('system_admin'))
        .send({})
        .expect(201);
      expect(service.discoverEndpoints).toHaveBeenCalledTimes(1);
    });
  });

  it('GET /systems/dashboard delega sin parámetros', async () => {
    const payload = { endpoints: 42, tools: 5 };
    service.getDashboard.mockResolvedValueOnce(payload);
    const res = await request(app.getHttpServer())
      .get('/systems/dashboard')
      .set(...authHeader('readonly_auditor'))
      .expect(200);
    expect(res.body).toEqual(payload);
  });

  it('GET /systems/endpoints/:endpointId valida positiveId (400 si no es numérico)', async () => {
    await request(app.getHttpServer())
      .get('/systems/endpoints/abc')
      .set(...authHeader('system_admin'))
      .expect(400);
    expect(service.getEndpoint).not.toHaveBeenCalled();
  });

  it('GET /systems/endpoints/:endpointId delega con el id parseado', async () => {
    await request(app.getHttpServer())
      .get('/systems/endpoints/42')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(service.getEndpoint).toHaveBeenCalledWith('42');
  });

  it('POST /systems/endpoints/catalog-seed/refresh aplica defaults del schema y delega', async () => {
    await request(app.getHttpServer())
      .post('/systems/endpoints/catalog-seed/refresh')
      .set(...authHeader('system_admin'))
      .send({})
      .expect(201);
    expect(service.refreshCatalogSeed).toHaveBeenCalledWith(
      { includeTools: true, includeDataEntities: true, includeEndpointSeeds: true },
      expect.objectContaining({ role: 'system_admin' }),
    );
  });

  it('GET /systems/tools/:toolId delega', async () => {
    await request(app.getHttpServer())
      .get('/systems/tools/9')
      .set(...authHeader('qa_engineer'))
      .expect(200);
    expect(service.getTool).toHaveBeenCalledWith('9');
  });

  it('POST /systems/tools/infer-requirements delega al SystemsToolInferenceService (no al catalog service)', async () => {
    await request(app.getHttpServer())
      .post('/systems/tools/infer-requirements')
      .set(...authHeader('system_admin'))
      .send({ persist: false })
      .expect(201);
    expect(toolInferenceService.infer).toHaveBeenCalledWith({ persist: false });
  });

  it('POST /systems/data-entities/infer-impacts delega al SystemsDataImpactInferenceService', async () => {
    await request(app.getHttpServer())
      .post('/systems/data-entities/infer-impacts')
      .set(...authHeader('system_admin'))
      .send({})
      .expect(201);
    expect(dataImpactInferenceService.infer).toHaveBeenCalledWith({ persist: true });
  });

  it('GET /systems/data-entities/:entityId delega', async () => {
    await request(app.getHttpServer())
      .get('/systems/data-entities/3')
      .set(...authHeader('risk_analyst'))
      .expect(200);
    expect(service.getDataEntity).toHaveBeenCalledWith('3');
  });

  it('PATCH /systems/data-entities/:entityId/metadata valida y delega metadata soportada', async () => {
    const body = { dataOwner: 'risk-team', containsRiskData: true };
    await request(app.getHttpServer())
      .patch('/systems/data-entities/3/metadata')
      .set(...authHeader('platform_admin'))
      .send(body)
      .expect(200);
    expect(service.updateDataEntityMetadata).toHaveBeenCalledWith('3', body);
  });

  it('PATCH /systems/data-entities/:entityId/metadata rechaza con 403 para readonly_auditor', async () => {
    await request(app.getHttpServer())
      .patch('/systems/data-entities/3/metadata')
      .set(...authHeader('readonly_auditor'))
      .send({})
      .expect(403);
  });

  it('GET /systems/domains/:domainCode delega', async () => {
    await request(app.getHttpServer())
      .get('/systems/domains/RISK')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(service.getDomain).toHaveBeenCalledWith('RISK');
  });

  it('GET /systems/impact/by-endpoint/:endpointId delega', async () => {
    await request(app.getHttpServer())
      .get('/systems/impact/by-endpoint/7')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(service.getImpactByEndpoint).toHaveBeenCalledWith('7');
  });

  it('GET /systems/impact/by-table/:schemaName/:tableName delega ambos parámetros', async () => {
    await request(app.getHttpServer())
      .get('/systems/impact/by-table/public/customers')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(service.getImpactByTable).toHaveBeenCalledWith('public', 'customers');
  });

  it('GET /systems/health/tools delega sin parámetros', async () => {
    await request(app.getHttpServer())
      .get('/systems/health/tools')
      .set(...authHeader('devops'))
      .expect(200);
    expect(service.getToolsHealth).toHaveBeenCalledTimes(1);
  });

  it('GET /systems/endpoints aplica filtros de query y pagina', async () => {
    await request(app.getHttpServer())
      .get('/systems/endpoints?module=risk&status=ACTIVE&riskLevel=HIGH&page=2&limit=10')
      .set(...authHeader('system_admin'))
      .expect(200);
    expect(service.listEndpoints).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'risk', status: 'ACTIVE', riskLevel: 'HIGH', page: 2, limit: 10 }),
    );
  });

  it('GET /systems/endpoints rechaza riskLevel fuera del enum con 400', async () => {
    await request(app.getHttpServer())
      .get('/systems/endpoints?riskLevel=SUPER_HIGH')
      .set(...authHeader('system_admin'))
      .expect(400);
  });
});
