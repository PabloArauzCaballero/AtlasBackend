import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ProviderAuthAdminController } from '../../../src/modules/external-data/controllers/provider-auth.controller.js';
import { AuthBrokerClient } from '../../../src/modules/external-data/infrastructure/auth-broker/auth-broker.client.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de las tres rutas que rotan, revocan e invalidan credenciales de proveedores
 * externos (hallazgo UNTESTED_WRITE): hoy sólo hay un spec unitario
 * (`test/unit/external-data/provider-auth.controller.spec.ts`) que llama al controlador
 * directamente, sin pasar por HTTP ni por los guards reales.
 *
 * Las tres exigen `@Roles('admin', 'platform_admin')` a nivel de MÉTODO, más estrecho que el
 * `@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')` de la clase: un
 * analista de riesgo puede leer el estado de autenticación pero no puede sustituir una credencial.
 * Ese es justo el caso que un spec unitario sobre el controlador no puede demostrar, porque no hay
 * guard que ejecutar.
 */
describe('ProviderAuthAdminController (e2e/supertest)', () => {
  let app: INestApplication;

  const broker = {
    rotateCredential: jest.fn(async (..._args: unknown[]) => ({
      providerCode: 'BURO',
      field: 'CLIENT_SECRET',
      fingerprint: 'sha256:abc',
      rotatedAt: '2026-09-30T00:00:00.000Z',
    })),
    revokeCredential: jest.fn(async (..._args: unknown[]) => ({ providerCode: 'BURO', revokedAt: '2026-09-30T00:00:00.000Z' })),
    invalidateToken: jest.fn(async (..._args: unknown[]) => ({ providerCode: 'BURO', invalidated: true })),
    // Métodos de sólo lectura que el controlador también expone: Nest resuelve el controlador
    // ENTERO al armar el módulo, así que sin ellos no arranca ninguno de los casos de esta suite.
    availability: jest.fn(async () => ({ configured: true, reachable: true })),
    listAuthStates: jest.fn(async () => []),
    pendingRotation: jest.fn(async () => []),
    authStateFor: jest.fn(async () => ({})),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp([ProviderAuthAdminController], [{ provide: AuthBrokerClient, useValue: broker }]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST admin/external-providers/:providerCode/credentials/rotate', () => {
    const body = { field: 'CLIENT_SECRET', material: 'material-nuevo-de-sobra', reason: 'rotación programada' };

    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/rotate')
        .set(...TENANT_HEADER)
        .send(body)
        .expect(401);
      expect(broker.rotateCredential).not.toHaveBeenCalled();
    });

    it('un analista de riesgo (permitido a nivel de clase) recibe 403: rotar exige admin/platform_admin', async () => {
      await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/rotate')
        .set(...authHeader('risk_analyst'))
        .set(...TENANT_HEADER)
        .send(body)
        .expect(403);
      expect(broker.rotateCredential).not.toHaveBeenCalled();
    });

    it('un cuerpo sin el campo "reason" se rechaza antes de rotar nada', async () => {
      await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/rotate')
        .set(...authHeader('admin'))
        .set(...TENANT_HEADER)
        .send({ field: 'CLIENT_SECRET', material: 'material-nuevo-de-sobra' })
        .expect(400);
      expect(broker.rotateCredential).not.toHaveBeenCalled();
    });

    it('un admin rota la credencial y recibe 200 con la huella, nunca el material', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/rotate')
        .set(...authHeader('admin'))
        .set(...TENANT_HEADER)
        .send(body)
        .expect(200);

      expect(response.body).toMatchObject({ providerCode: 'BURO', fingerprint: 'sha256:abc' });
      expect(JSON.stringify(response.body)).not.toContain('material-nuevo-de-sobra');
      expect(broker.rotateCredential).toHaveBeenCalledWith('BURO', 'CLIENT_SECRET', 'material-nuevo-de-sobra');
    });
  });

  describe('POST admin/external-providers/:providerCode/credentials/revoke', () => {
    const body = { reason: 'sospecha de filtración' };

    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/revoke')
        .set(...TENANT_HEADER)
        .send(body)
        .expect(401);
      expect(broker.revokeCredential).not.toHaveBeenCalled();
    });

    it('un analista de cumplimiento recibe 403: revocar exige admin/platform_admin', async () => {
      await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/revoke')
        .set(...authHeader('compliance_analyst'))
        .set(...TENANT_HEADER)
        .send(body)
        .expect(403);
      expect(broker.revokeCredential).not.toHaveBeenCalled();
    });

    it('un platform_admin revoca y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/revoke')
        .set(...authHeader('platform_admin'))
        .set(...TENANT_HEADER)
        .send(body)
        .expect(200);

      expect(response.body).toMatchObject({ providerCode: 'BURO' });
      expect(broker.revokeCredential).toHaveBeenCalledWith('BURO', 'sospecha de filtración');
    });
  });

  describe('POST admin/external-providers/:providerCode/credentials/invalidate-token', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/invalidate-token')
        .set(...TENANT_HEADER)
        .send({})
        .expect(401);
      expect(broker.invalidateToken).not.toHaveBeenCalled();
    });

    it('un operador interno (fuera incluso del rol de clase) recibe 403', async () => {
      await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/invalidate-token')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({})
        .expect(403);
      expect(broker.invalidateToken).not.toHaveBeenCalled();
    });

    it('un admin fuerza la renovación del token y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/external-providers/buro/credentials/invalidate-token')
        .set(...authHeader('admin'))
        .set(...TENANT_HEADER)
        .send({})
        .expect(200);

      expect(response.body).toMatchObject({ providerCode: 'BURO', invalidated: true });
      expect(broker.invalidateToken).toHaveBeenCalledWith('BURO');
    });
  });
});
