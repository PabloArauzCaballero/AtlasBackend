import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../src/common/services/token-revocation.service.js';
import { NotificationAudienceSegmentsController } from '../../../src/modules/notifications/campaigns/notification-audience-segments.controller.js';
import { NotificationCampaignAudienceService } from '../../../src/modules/notifications/campaigns/notification-campaign-audience.service.js';
import { NotificationCampaignTestSendService } from '../../../src/modules/notifications/campaigns/notification-campaign-test-send.service.js';
import { NotificationCampaignService } from '../../../src/modules/notifications/campaigns/notification-campaign.service.js';
import { NotificationCampaignsController } from '../../../src/modules/notifications/campaigns/notification-campaigns.controller.js';
import { authHeader } from './support/notifications-test-app.js';

/**
 * Guards reales (JWT, tenant, roles) y validación zod real sobre HTTP para las rutas de campañas. Lo
 * que se fija: leer lo puede un operador interno, escribir sólo admin; toda creación y programación
 * exige clave de idempotencia; un cuerpo inválido no llega al servicio.
 */
describe('Campañas de notificación (e2e/supertest)', () => {
  let app: INestApplication;
  const campaigns = {
    list: jest.fn(async (..._args: unknown[]) => ({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
    create: jest.fn(async (..._args: unknown[]) => ({ id: '1', status: 'draft' })),
    get: jest.fn(async (..._args: unknown[]) => ({ id: '1' })),
    listMessages: jest.fn(async (..._args: unknown[]) => ({ data: [] })),
    update: jest.fn(async (..._args: unknown[]) => ({ id: '1' })),
    schedule: jest.fn(async (..._args: unknown[]) => ({ id: '1', status: 'scheduled' })),
    unschedule: jest.fn(async (..._args: unknown[]) => ({ id: '1' })),
    pause: jest.fn(async (..._args: unknown[]) => ({ id: '1' })),
    resume: jest.fn(async (..._args: unknown[]) => ({ id: '1' })),
    cancel: jest.fn(async (..._args: unknown[]) => ({ id: '1' })),
    duplicate: jest.fn(async (..._args: unknown[]) => ({ id: '2' })),
  };
  const audience = {
    estimate: jest.fn(async (..._args: unknown[]) => ({ total: 5 })),
    listSegments: jest.fn(async (..._args: unknown[]) => ({ data: [] })),
    createSegment: jest.fn(async (..._args: unknown[]) => ({ id: '3' })),
    updateSegment: jest.fn(async (..._args: unknown[]) => ({ id: '3' })),
  };
  const testSend = { send: jest.fn(async (..._args: unknown[]) => ({ results: [] })) };
  const body = { name: 'Recordatorio', title: 'Hola', body: 'Texto', channels: ['in_app', 'push'] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationCampaignsController, NotificationAudienceSegmentsController],
      providers: [
        JwtAuthGuard,
        RolesGuard,
        TenantGuard,
        { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn() } },
        { provide: NotificationCampaignService, useValue: campaigns },
        { provide: NotificationCampaignAudienceService, useValue: audience },
        { provide: NotificationCampaignTestSendService, useValue: testSend },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('401 sin token', async () => {
    await request(server()).get('/operations/notifications/campaigns').expect(401);
  });

  it('un operador interno lee pero no crea', async () => {
    await request(server())
      .get('/operations/notifications/campaigns')
      .set(...authHeader('internal_operator'))
      .expect(200);
    await request(server())
      .post('/operations/notifications/campaigns')
      .set(...authHeader('internal_operator'))
      .set('x-idempotency-key', 'k1')
      .send(body)
      .expect(403);
    expect(campaigns.create).not.toHaveBeenCalled();
  });

  it('crear exige clave de idempotencia y un cuerpo válido', async () => {
    await request(server())
      .post('/operations/notifications/campaigns')
      .set(...authHeader('admin'))
      .send(body)
      .expect(400);
    await request(server())
      .post('/operations/notifications/campaigns')
      .set(...authHeader('admin'))
      .set('x-idempotency-key', 'k1')
      .send({ ...body, channels: ['fax'] })
      .expect(400);
    expect(campaigns.create).not.toHaveBeenCalled();
    await request(server())
      .post('/operations/notifications/campaigns')
      .set(...authHeader('admin'))
      .set('x-idempotency-key', 'k1')
      .send(body)
      .expect(201);
    expect(campaigns.create).toHaveBeenCalledWith('1', 'e2e-notifications-user', expect.objectContaining({ purpose: 'marketing' }), 'k1');
  });

  it('programar exige clave; pausar, reanudar, cancelar y duplicar llegan al servicio', async () => {
    await request(server())
      .post('/operations/notifications/campaigns/4/schedule')
      .set(...authHeader('admin'))
      .expect(400);
    await request(server())
      .post('/operations/notifications/campaigns/4/schedule')
      .set(...authHeader('admin'))
      .set('x-idempotency-key', 'k2')
      .expect(200);
    for (const action of ['pause', 'resume', 'unschedule']) {
      await request(server())
        .post(`/operations/notifications/campaigns/4/${action}`)
        .set(...authHeader('platform_admin'))
        .expect(200);
    }
    await request(server())
      .post('/operations/notifications/campaigns/4/cancel')
      .set(...authHeader('admin'))
      .send({ reason: 'corto' })
      .expect(400);
    await request(server())
      .post('/operations/notifications/campaigns/4/cancel')
      .set(...authHeader('admin'))
      .send({ reason: 'Texto equivocado' })
      .expect(200);
    await request(server())
      .post('/operations/notifications/campaigns/4/duplicate')
      .set(...authHeader('admin'))
      .set('x-idempotency-key', 'k3')
      .expect(201);
    expect(campaigns.cancel).toHaveBeenCalledWith('1', '4', { reason: 'Texto equivocado' });
  });

  it('detalle, avisos, edición, estimación y prueba', async () => {
    await request(server())
      .get('/operations/notifications/campaigns/abc')
      .set(...authHeader('admin'))
      .expect(400);
    await request(server())
      .get('/operations/notifications/campaigns/4')
      .set(...authHeader('internal_operator'))
      .expect(200);
    await request(server())
      .get('/operations/notifications/campaigns/4/messages?page=1&limit=5')
      .set(...authHeader('admin'))
      .expect(200);
    await request(server())
      .patch('/operations/notifications/campaigns/4')
      .set(...authHeader('admin'))
      .send({ title: 'Nuevo' })
      .expect(200);
    await request(server())
      .post('/operations/notifications/campaigns/audience/estimate')
      .set(...authHeader('internal_operator'))
      .send({ purpose: 'operational', audience: { match: 'all', rules: [{ attribute: 'hasActiveLoan', operator: 'is_true' }] } })
      .expect(200);
    await request(server())
      .post('/operations/notifications/campaigns/4/test-send')
      .set(...authHeader('admin'))
      .send({ customerId: '9' })
      .expect(200);
    expect(testSend.send).toHaveBeenCalledWith('1', '4', { customerId: '9' });
  });

  it('segmentos: operador lee, admin crea y edita', async () => {
    await request(server())
      .get('/operations/notifications/audience-segments')
      .set(...authHeader('internal_operator'))
      .expect(200);
    const segment = { name: 'Mora', definition: { match: 'all', rules: [{ attribute: 'hasOverdueInstallment', operator: 'is_true' }] } };
    await request(server())
      .post('/operations/notifications/audience-segments')
      .set(...authHeader('internal_operator'))
      .send(segment)
      .expect(403);
    await request(server())
      .post('/operations/notifications/audience-segments')
      .set(...authHeader('admin'))
      .send(segment)
      .expect(201);
    await request(server())
      .patch('/operations/notifications/audience-segments/3')
      .set(...authHeader('admin'))
      .send({ status: 'archived' })
      .expect(200);
    expect(audience.updateSegment).toHaveBeenCalledWith('1', '3', { status: 'archived' });
  });
});
