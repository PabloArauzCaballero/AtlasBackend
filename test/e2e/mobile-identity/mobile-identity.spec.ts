import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MobileIdentityController } from '../../../src/modules/mobile-identity/mobile-identity.controller.js';
import { MobileIdentityService } from '../../../src/modules/mobile-identity/mobile-identity.service.js';
import { authHeader, buildGenericTestApp, IDEMPOTENCY_HEADER, TENANT_HEADER } from '../support/generic-test-app.js';

// Base64 mínimo válido (>=64 chars) para pasar el regex de `imagenBase64`.
const IMG = 'A'.repeat(80);

/**
 * Contrato HTTP de `POST mobile/identity-verifications`.
 *
 * No hay `:customerId` en la ruta —el cliente al que pertenece la verificación viaja, si existe,
 * DENTRO del cuerpo (`customerId`, opcional)— así que no hay comprobación de propiedad de URL que
 * fijar aquí: lo que el HTTP decide es el rol, la cabecera de idempotencia y la forma del cuerpo.
 */
describe('MobileIdentityController (e2e/supertest) — POST mobile/identity-verifications', () => {
  let app: INestApplication;

  const service = {
    start: jest.fn(async (..._args: unknown[]) => ({ verificationId: 'v-1', status: 'PENDING' })),
    get: jest.fn(async (..._args: unknown[]) => ({ verificationId: 'v-1', status: 'PENDING' })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp([MobileIdentityController], [{ provide: MobileIdentityService, useValue: service }]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/mobile/identity-verifications')
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ documentFront: IMG, selfie: IMG })
      .expect(401);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('un rol sin acceso (merchant) NO puede iniciar una verificación', async () => {
    await request(app.getHttpServer())
      .post('/mobile/identity-verifications')
      .set(...authHeader('merchant'))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ documentFront: IMG, selfie: IMG })
      .expect(403);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('sin x-idempotency-key se rechaza antes de llamar al servicio', async () => {
    await request(app.getHttpServer())
      .post('/mobile/identity-verifications')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .send({ documentFront: IMG, selfie: IMG })
      .expect(400);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('rechaza una imagen que no es base64 válido', async () => {
    await request(app.getHttpServer())
      .post('/mobile/identity-verifications')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ documentFront: '!!! no es base64 !!!', selfie: IMG })
      .expect(400);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('el cliente envía carnet y selfie y recibe 202 con el identificador', async () => {
    const response = await request(app.getHttpServer())
      .post('/mobile/identity-verifications')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .set(...IDEMPOTENCY_HEADER)
      .send({ documentFront: IMG, selfie: IMG })
      .expect(202);

    expect(response.body).toMatchObject({ verificationId: 'v-1', status: 'PENDING' });
    const [tenantId, , idempotencyKey] = service.start.mock.calls[0] as unknown as [string, unknown, string];
    expect(tenantId).toBe('1');
    expect(idempotencyKey).toBe('idem-e2e-generic-1');
  });
});
