import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { NotificationsService } from '../../../src/modules/notifications/notifications.service.js';
import { buildNotificationsTestApp, authHeader } from './support/notifications-test-app.js';

/**
 * Tests HTTP end-to-end del inbox de autoservicio para usuarios internos
 * (`internal-users/me/notifications*`) — la respuesta a "el usuario debe poder revisar las
 * notificaciones" para el staff que recibe alertas de servicios caídos y broadcasts de admin.
 * `recipientId` sale siempre de `currentUser.internalUserId` (nunca de un parámetro de ruta), así
 * que estos tests verifican explícitamente que el service recibe SIEMPRE el internalUserId del
 * token, sin importar qué token se use.
 */
describe('NotificationsController — internal-users/me/notifications (e2e/supertest)', () => {
  let app: INestApplication;
  const service = {
    listMyNotifications: jest.fn(async () => ({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
    myUnreadCount: jest.fn(async () => ({ unread: 0 })),
    markMyNotificationRead: jest.fn(async () => ({ id: '1', status: 'read' })),
    markAllMyNotificationsRead: jest.fn(async () => ({ updated: 0 })),
  };

  beforeAll(async () => {
    app = await buildNotificationsTestApp([{ provide: NotificationsService, useValue: service }]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET internal-users/me/notifications', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer()).get('/internal-users/me/notifications').expect(401);
    });

    it('rechaza con 403 a un token de customer (no es un usuario interno)', async () => {
      await request(app.getHttpServer())
        .get('/internal-users/me/notifications')
        .set(...authHeader('customer'))
        .expect(403);
    });

    it('200 con un rol interno válido, usando el internalUserId del token como recipientId', async () => {
      const res = await request(app.getHttpServer())
        .get('/internal-users/me/notifications')
        .set(...authHeader('internal_operator', { internalUserId: 'iu-77' }))
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(service.listMyNotifications).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ page: 1, limit: 20 }),
        expect.objectContaining({ internalUserId: 'iu-77' }),
      );
    });

    // Regresión: la lista original de roles para estos 4 endpoints de autoservicio omitía
    // 'qa_engineer' y 'readonly_auditor' — cualquier interno con esos roles funcionales recibía
    // 403 al intentar revisar SU PROPIO inbox (p. ej. una alerta de servicio caído que el propio
    // backend le mandó). Un usuario interno debe poder ver sus notificaciones sin importar su rol
    // funcional; ver INTERNAL_SELF_SERVICE_ROLES en el controller.
    it.each(['qa_engineer', 'readonly_auditor'] as const)(
      '200 para el rol interno "%s" (antes daba 403 — regresión)',
      async (role) => {
        await request(app.getHttpServer())
          .get('/internal-users/me/notifications')
          .set(...authHeader(role, { internalUserId: 'iu-qa' }))
          .expect(200);
      },
    );
  });

  describe('GET internal-users/me/notifications/unread-count', () => {
    it('200 delega en myUnreadCount', async () => {
      service.myUnreadCount.mockResolvedValueOnce({ unread: 4 });
      const res = await request(app.getHttpServer())
        .get('/internal-users/me/notifications/unread-count')
        .set(...authHeader('risk_analyst', { internalUserId: 'iu-5' }))
        .expect(200);
      expect(res.body).toEqual({ unread: 4 });
    });
  });

  describe('POST internal-users/me/notifications/:notificationId/read', () => {
    it('200 delega el notificationId de la ruta y el currentUser', async () => {
      await request(app.getHttpServer())
        .post('/internal-users/me/notifications/42/read')
        .set(...authHeader('compliance_analyst', { internalUserId: 'iu-9' }))
        .expect(200);

      expect(service.markMyNotificationRead).toHaveBeenCalledWith('1', '42', expect.objectContaining({ internalUserId: 'iu-9' }));
    });

    it('rechaza con 400 un notificationId no numérico (ZodValidationPipe)', async () => {
      await request(app.getHttpServer())
        .post('/internal-users/me/notifications/not-a-number/read')
        .set(...authHeader('internal_operator', { internalUserId: 'iu-9' }))
        .expect(400);
      expect(service.markMyNotificationRead).not.toHaveBeenCalled();
    });
  });

  describe('POST internal-users/me/notifications/read-all', () => {
    it('200 delega en markAllMyNotificationsRead con el currentUser del token', async () => {
      service.markAllMyNotificationsRead.mockResolvedValueOnce({ updated: 7 });
      const res = await request(app.getHttpServer())
        .post('/internal-users/me/notifications/read-all')
        .set(...authHeader('fraud_analyst', { internalUserId: 'iu-3' }))
        .expect(200);

      expect(res.body).toEqual({ updated: 7 });
      expect(service.markAllMyNotificationsRead).toHaveBeenCalledWith('1', expect.objectContaining({ internalUserId: 'iu-3' }));
    });
  });
});
