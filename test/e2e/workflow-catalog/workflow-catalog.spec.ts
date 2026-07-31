import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { WorkflowCatalogController } from '../../../src/modules/workflow-catalog/workflow-catalog.controller.js';
import { WorkflowCatalogService } from '../../../src/modules/workflow-catalog/workflow-catalog.service.js';
import { WorkflowTransitionService } from '../../../src/modules/workflow-catalog/application/workflow-transition.service.js';
import { authHeader, buildWorkflowTestApp } from './support/workflow-test-app.js';

describe('WorkflowCatalogController (e2e/supertest)', () => {
  let app: INestApplication;
  const catalogService = {
    listWorkflows: jest.fn(async () => []),
    listVersions: jest.fn(async () => []),
    getTree: jest.fn(async () => ({ workflowCode: 'customer_credit_journey', stages: [] })),
    listStages: jest.fn(async () => []),
    listTransitions: jest.fn(async () => []),
    getGraph: jest.fn(async () => ({ nodes: [], edges: [] })),
  };
  const transitionService = { validate: jest.fn(async () => ({ allowed: true })) };

  beforeAll(async () => {
    app = await buildWorkflowTestApp(
      [WorkflowCatalogController],
      [
        { provide: WorkflowCatalogService, useValue: catalogService },
        { provide: WorkflowTransitionService, useValue: transitionService },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('seguridad', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer()).get('/workflows').expect(401);
      expect(catalogService.listWorkflows).not.toHaveBeenCalled();
    });

    it('rechaza con 401 un token con firma inválida', async () => {
      await request(app.getHttpServer()).get('/workflows').set('Authorization', 'Bearer no-es-un-jwt').expect(401);
    });

    it('rechaza con 403 a un rol fuera del conjunto de lectura del catálogo', async () => {
      await request(app.getHttpServer())
        .get('/workflows')
        .set(...authHeader('merchant'))
        .expect(403);
      expect(catalogService.listWorkflows).not.toHaveBeenCalled();
    });

    it('permite a un customer leer el catálogo: es quien recorre el flujo', async () => {
      await request(app.getHttpServer())
        .get('/workflows')
        .set(...authHeader('customer'))
        .expect(200);
    });

    it('permite a roles de auditoría de solo lectura', async () => {
      await request(app.getHttpServer())
        .get('/workflows')
        .set(...authHeader('readonly_auditor'))
        .expect(200);
    });
  });

  describe('GET /workflows', () => {
    it('aplica los valores por defecto del schema al servicio', async () => {
      await request(app.getHttpServer())
        .get('/workflows')
        .set(...authHeader('platform_admin'))
        .expect(200);

      expect(catalogService.listWorkflows).toHaveBeenCalledWith(expect.objectContaining({ includeDeprecated: false }));
    });

    it('rechaza con 400 un status fuera del vocabulario cerrado', async () => {
      const response = await request(app.getHttpServer())
        .get('/workflows?status=inventado')
        .set(...authHeader('platform_admin'))
        .expect(400);

      expect(response.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'status' })]));
      expect(catalogService.listWorkflows).not.toHaveBeenCalled();
    });

    it('propaga los filtros de módulo y rol', async () => {
      await request(app.getHttpServer())
        .get('/workflows?moduleCode=credit&role=risk_analyst&includeDeprecated=true')
        .set(...authHeader('platform_admin'))
        .expect(200);

      expect(catalogService.listWorkflows).toHaveBeenCalledWith(
        expect.objectContaining({ moduleCode: 'credit', role: 'risk_analyst', includeDeprecated: true }),
      );
    });
  });

  describe('GET /workflows/:workflowCode', () => {
    it('rechaza con 400 un código que no es snake_case', async () => {
      await request(app.getHttpServer())
        .get('/workflows/Flujo-Con-Mayusculas')
        .set(...authHeader('platform_admin'))
        .expect(400);
      expect(catalogService.getTree).not.toHaveBeenCalled();
    });

    it('rechaza con 400 una versión con formato inválido', async () => {
      await request(app.getHttpServer())
        .get('/workflows/customer_credit_journey?version=ultima')
        .set(...authHeader('platform_admin'))
        .expect(400);
    });

    it('usa `latest` cuando no se indica versión', async () => {
      await request(app.getHttpServer())
        .get('/workflows/customer_credit_journey')
        .set(...authHeader('platform_admin'))
        .expect(200);

      expect(catalogService.getTree).toHaveBeenCalledWith('customer_credit_journey', expect.objectContaining({ version: 'latest' }));
    });

    it('acepta una versión concreta', async () => {
      await request(app.getHttpServer())
        .get('/workflows/customer_credit_journey?version=v2')
        .set(...authHeader('platform_admin'))
        .expect(200);

      expect(catalogService.getTree).toHaveBeenCalledWith('customer_credit_journey', expect.objectContaining({ version: 'v2' }));
    });

    it('traduce el flujo inexistente a 404', async () => {
      catalogService.getTree.mockRejectedValueOnce(new NotFoundException('WORKFLOW_NOT_FOUND'));

      await request(app.getHttpServer())
        .get('/workflows/inexistente')
        .set(...authHeader('platform_admin'))
        .expect(404);
    });

    it('no confunde /versions con un código de flujo', async () => {
      await request(app.getHttpServer())
        .get('/workflows/customer_credit_journey/versions')
        .set(...authHeader('platform_admin'))
        .expect(200);

      expect(catalogService.listVersions).toHaveBeenCalledWith('customer_credit_journey');
    });
  });

  describe('subrecursos del flujo', () => {
    it.each([
      ['stages', 'listStages'],
      ['transitions', 'listTransitions'],
      ['graph', 'getGraph'],
    ])('GET /workflows/:code/%s delega en el servicio', async (path, method) => {
      await request(app.getHttpServer())
        .get(`/workflows/customer_credit_journey/${path}`)
        .set(...authHeader('platform_admin'))
        .expect(200);

      expect(catalogService[method as keyof typeof catalogService]).toHaveBeenCalledWith(
        'customer_credit_journey',
        expect.objectContaining({ version: 'latest' }),
      );
    });
  });

  describe('POST /workflows/:code/transitions/validate', () => {
    it('responde 200 (no 201): es una consulta, no crea nada', async () => {
      await request(app.getHttpServer())
        .post('/workflows/customer_credit_journey/transitions/validate')
        .set(...authHeader('platform_admin'))
        .send({ toStepCode: 'onboarding.submit' })
        .expect(200);
    });

    it('rechaza con 400 si falta el paso destino', async () => {
      const response = await request(app.getHttpServer())
        .post('/workflows/customer_credit_journey/transitions/validate')
        .set(...authHeader('platform_admin'))
        .send({ fromStepCode: 'contact.submit_code' })
        .expect(400);

      expect(response.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'toStepCode' })]));
      expect(transitionService.validate).not.toHaveBeenCalled();
    });

    it('aplica el default de completedStepCodes y de versión', async () => {
      await request(app.getHttpServer())
        .post('/workflows/customer_credit_journey/transitions/validate')
        .set(...authHeader('platform_admin'))
        .send({ toStepCode: 'onboarding.submit' })
        .expect(200);

      expect(transitionService.validate).toHaveBeenCalledWith(
        'customer_credit_journey',
        expect.objectContaining({ version: 'latest', completedStepCodes: [] }),
      );
    });

    it('rechaza con 400 una lista de pasos completados demasiado grande', async () => {
      await request(app.getHttpServer())
        .post('/workflows/customer_credit_journey/transitions/validate')
        .set(...authHeader('platform_admin'))
        .send({ toStepCode: 'x', completedStepCodes: Array.from({ length: 201 }, (_, i) => `s${i}`) })
        .expect(400);
    });
  });
});
