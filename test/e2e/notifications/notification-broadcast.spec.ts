import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { NotificationsService } from '../../../src/modules/notifications/notifications.service.js';
import { buildNotificationsTestApp, authHeader } from './support/notifications-test-app.js';

/**
 * Tests HTTP end-to-end (Supertest) del endpoint nuevo de broadcast de admin. A diferencia de los
 * tests unitarios de `NotificationBroadcastService` (que prueban la lógica de resolución de
 * destinatarios), esto ejerce guards reales (JwtAuthGuard/TenantGuard/RolesGuard) y el
 * ZodValidationPipe de `createBroadcastNotificationSchema` sobre HTTP real.
 */
describe('NotificationsController — POST /operations/notifications/broadcast (e2e/supertest)', () => {
  let app: INestApplication;
  const service = {
    broadcast: jest.fn(async () => ({ broadcastId: 'bcast-1', targeted: 2, created: 2 })),
  };

  beforeAll(async () => {
    app = await buildNotificationsTestApp([{ provide: NotificationsService, useValue: service }]);
  });

  afterAll(async () => {
    await app.close();
  });

  const validBody = { title: 'Mantenimiento', body: 'El sistema estará en mantenimiento a las 22:00.', audience: 'customers' };

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/operations/notifications/broadcast')
      .set('x-idempotency-key', 'idem-1')
      .send(validBody)
      .expect(401);
    expect(service.broadcast).not.toHaveBeenCalled();
  });

  it('rechaza con 403 a un rol no-admin (internal_operator no puede disparar broadcasts)', async () => {
    await request(app.getHttpServer())
      .post('/operations/notifications/broadcast')
      .set(...authHeader('internal_operator'))
      .set('x-idempotency-key', 'idem-1')
      .send(validBody)
      .expect(403);
    expect(service.broadcast).not.toHaveBeenCalled();
  });

  it('rechaza con 400 sin X-Idempotency-Key', async () => {
    await request(app.getHttpServer())
      .post('/operations/notifications/broadcast')
      .set(...authHeader('admin'))
      .send(validBody)
      .expect(400);
    expect(service.broadcast).not.toHaveBeenCalled();
  });

  it('rechaza con 400 cuando audience: internal_users viene con customerIds (refine cruzado del schema)', async () => {
    await request(app.getHttpServer())
      .post('/operations/notifications/broadcast')
      .set(...authHeader('admin'))
      .set('x-idempotency-key', 'idem-1')
      .send({ ...validBody, audience: 'internal_users', customerIds: ['1'] })
      .expect(400);
    expect(service.broadcast).not.toHaveBeenCalled();
  });

  it('rechaza con 403 cuando x-tenant-id no coincide con el tenant del token (TenantGuard)', async () => {
    await request(app.getHttpServer())
      .post('/operations/notifications/broadcast')
      .set(...authHeader('admin'))
      .set('x-tenant-id', '999')
      .set('x-idempotency-key', 'idem-1')
      .send(validBody)
      .expect(403);
    expect(service.broadcast).not.toHaveBeenCalled();
  });

  it('201 con admin + idempotency-key + x-tenant-id: aplica default de priority=0 y delega el tenantId del header (x-tenant-id es requerido en los endpoints de operations, no se infiere del token)', async () => {
    const res = await request(app.getHttpServer())
      .post('/operations/notifications/broadcast')
      .set(...authHeader('admin'))
      .set('x-tenant-id', '1')
      .set('x-idempotency-key', 'idem-1')
      .send(validBody)
      .expect(201);

    expect(res.body).toEqual({ broadcastId: 'bcast-1', targeted: 2, created: 2 });
    expect(service.broadcast).toHaveBeenCalledWith('1', expect.objectContaining({ ...validBody, priority: 0, category: 'custom_broadcast' }));
  });

  it('platform_admin y system también pueden disparar broadcasts', async () => {
    await request(app.getHttpServer())
      .post('/operations/notifications/broadcast')
      .set(...authHeader('platform_admin'))
      .set('x-tenant-id', '1')
      .set('x-idempotency-key', 'idem-2')
      .send({ ...validBody, audience: 'both' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/operations/notifications/broadcast')
      .set(...authHeader('system'))
      .set('x-tenant-id', '1')
      .set('x-idempotency-key', 'idem-3')
      .send({ ...validBody, audience: 'internal_users' })
      .expect(201);
    expect(service.broadcast).toHaveBeenCalledTimes(2);
  });
});
