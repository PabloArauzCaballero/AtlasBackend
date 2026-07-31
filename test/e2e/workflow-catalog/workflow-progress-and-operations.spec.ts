import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { WorkflowProgressController } from '../../../src/modules/workflow-catalog/workflow-progress.controller.js';
import { WorkflowProgressService } from '../../../src/modules/workflow-catalog/application/workflow-progress.service.js';
import { WorkflowOperationsController } from '../../../src/modules/workflow-catalog/workflow-operations.controller.js';
import { WorkflowConsistencyService } from '../../../src/modules/workflow-catalog/application/workflow-consistency.service.js';
import { authHeader, buildWorkflowTestApp } from './support/workflow-test-app.js';

describe('WorkflowProgressController (e2e/supertest)', () => {
  let app: INestApplication;
  const progressService = { getProgress: jest.fn(async () => ({ customerId: '7', stages: [] })) };

  beforeAll(async () => {
    app = await buildWorkflowTestApp([WorkflowProgressController], [{ provide: WorkflowProgressService, useValue: progressService }]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer()).get('/customers/7/workflow-progress').expect(401);
    expect(progressService.getProgress).not.toHaveBeenCalled();
  });

  it('rechaza con 403 a un rol ajeno al recorrido del cliente', async () => {
    await request(app.getHttpServer())
      .get('/customers/7/workflow-progress')
      .set(...authHeader('devops', { tenantId: '1' }))
      .set('x-tenant-id', '1')
      .expect(403);
  });

  it('rechaza con 403 si el header de tenant no coincide con el del token', async () => {
    await request(app.getHttpServer())
      .get('/customers/7/workflow-progress')
      .set(...authHeader('internal_operator', { tenantId: '1' }))
      .set('x-tenant-id', '2')
      .expect(403);
    expect(progressService.getProgress).not.toHaveBeenCalled();
  });

  it('toma el tenant del token cuando el cliente no envía el header', async () => {
    await request(app.getHttpServer())
      .get('/customers/7/workflow-progress')
      .set(...authHeader('customer', { tenantId: '3', customerId: '7' }))
      .expect(200);

    expect(progressService.getProgress).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '3', customerId: '7' }));
  });

  it('rechaza con 400 un customerId no numérico', async () => {
    await request(app.getHttpServer())
      .get('/customers/abc/workflow-progress')
      .set(...authHeader('internal_operator', { tenantId: '1' }))
      .set('x-tenant-id', '1')
      .expect(400);
  });

  it('rechaza con 400 un workflowCode con formato inválido', async () => {
    await request(app.getHttpServer())
      .get('/customers/7/workflow-progress?workflowCode=Flujo%20Raro')
      .set(...authHeader('internal_operator', { tenantId: '1' }))
      .set('x-tenant-id', '1')
      .expect(400);
  });

  it('propaga workflowCode y versión al servicio', async () => {
    await request(app.getHttpServer())
      .get('/customers/7/workflow-progress?workflowCode=customer_credit_journey&version=v1')
      .set(...authHeader('internal_operator', { tenantId: '1' }))
      .set('x-tenant-id', '1')
      .expect(200);

    expect(progressService.getProgress).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ workflowCode: 'customer_credit_journey', version: 'v1' }) }),
    );
  });
});

describe('WorkflowOperationsController (e2e/supertest)', () => {
  let app: INestApplication;
  const consistencyService = { check: jest.fn(async () => ({ status: 'in_sync', issues: [] })) };

  beforeAll(async () => {
    app = await buildWorkflowTestApp(
      [WorkflowOperationsController],
      [{ provide: WorkflowConsistencyService, useValue: consistencyService }],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer()).get('/operations/workflows/customer_credit_journey/consistency').expect(401);
  });

  it('no expone el informe a un customer: revela controladores y rutas internas', async () => {
    await request(app.getHttpServer())
      .get('/operations/workflows/customer_credit_journey/consistency')
      .set(...authHeader('customer'))
      .expect(403);
    expect(consistencyService.check).not.toHaveBeenCalled();
  });

  it('tampoco lo expone a un analista de riesgo: es gobierno técnico, no operación de negocio', async () => {
    await request(app.getHttpServer())
      .get('/operations/workflows/customer_credit_journey/consistency')
      .set(...authHeader('risk_analyst'))
      .expect(403);
  });

  it.each(['system_admin', 'qa_engineer', 'devops', 'platform_admin'] as const)('permite el informe a %s', async (role) => {
    await request(app.getHttpServer())
      .get('/operations/workflows/customer_credit_journey/consistency')
      .set(...authHeader(role))
      .expect(200);
  });

  it('usa `latest` por defecto y acepta una versión concreta', async () => {
    await request(app.getHttpServer())
      .get('/operations/workflows/customer_credit_journey/consistency')
      .set(...authHeader('platform_admin'))
      .expect(200);
    expect(consistencyService.check).toHaveBeenCalledWith('customer_credit_journey', 'latest');

    await request(app.getHttpServer())
      .get('/operations/workflows/customer_credit_journey/consistency?version=v1')
      .set(...authHeader('platform_admin'))
      .expect(200);
    expect(consistencyService.check).toHaveBeenCalledWith('customer_credit_journey', 'v1');
  });

  it('rechaza con 400 una versión mal formada', async () => {
    await request(app.getHttpServer())
      .get('/operations/workflows/customer_credit_journey/consistency?version=vX')
      .set(...authHeader('platform_admin'))
      .expect(400);
  });
});
