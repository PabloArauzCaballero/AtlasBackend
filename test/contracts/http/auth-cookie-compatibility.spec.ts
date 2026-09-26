/**
 * @file AT-005 — contrato de cookies del login interno, contra el controlador real.
 * @business El portal interno sigue recibiendo su sesión en cookies `HttpOnly` (nunca tokens en el body),
 *   con los atributos de siempre; el logout las borra con los mismos atributos; el reto de PIN no emite
 *   cookies. Nada de esto depende de que el servicio de autenticación sea el del monolito.
 * @system supertest sobre `InternalAuthController` real con guards reales y `InternalAuthService` doble
 *   (devuelve tokens de prueba, sin secretos reales). Se asertan nombres y atributos, no valores.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { TenantGuard } from '../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../src/common/services/token-revocation.service.js';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../../../src/common/utils/http/auth-cookies.util.js';
import { env } from '../../../src/config/env.js';
import { InternalPermissionsGuard } from '../../../src/modules/internal-users/guards/internal-permissions.guard.js';
import { InternalAuthController } from '../../../src/modules/internal-users/internal-auth.controller.js';
import { InternalAuthService } from '../../../src/modules/internal-users/internal-auth.service.js';
import { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository.js';
import { InternalUsersService } from '../../../src/modules/internal-users/internal-users.service.js';

const SESSION = {
  accessToken: 'test-access-token-not-a-secret',
  refreshToken: 'test-refresh-token-not-a-secret',
  tokenType: 'Bearer' as const,
  expiresIn: '15m',
  internalUserId: '1',
  email: 'ops@example.test',
  roles: ['internal_operator'],
  permissions: [],
};

describe('AT-005 · cookies de la sesión interna', () => {
  let app: INestApplication;
  const auth = {
    login: jest.fn(async () => ({ ...SESSION })),
    verifyLoginPin: jest.fn(async () => ({ ...SESSION })),
    refresh: jest.fn(async () => ({ ...SESSION })),
    logout: jest.fn(async () => ({ revoked: 1 })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalAuthController],
      providers: [
        JwtAuthGuard,
        TenantGuard,
        InternalPermissionsGuard,
        { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn(async () => null) } },
        { provide: InternalRbacRepository, useValue: {} },
        { provide: InternalAuthService, useValue: auth },
        { provide: InternalUsersService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  const cookies = (response: request.Response): string[] =>
    ([] as string[]).concat((response.headers['set-cookie'] as unknown as string[]) ?? []);

  it('login: la sesión viaja en dos cookies HttpOnly con path=/ y sameSite configurado; el body no trae tokens', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/auth/login')
      .set('x-tenant-id', '1')
      .send({ email: 'ops@example.test', password: 'p' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tokenType: 'Cookie', expiresIn: '15m' });
    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('refreshToken');
    const set = cookies(response);
    const access = set.find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`));
    const refresh = set.find((cookie) => cookie.startsWith(`${REFRESH_TOKEN_COOKIE}=`));
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    for (const cookie of [access!, refresh!]) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie.toLowerCase()).toContain(`samesite=${String(env.AUTH_COOKIE_SAMESITE).toLowerCase()}`);
      expect(/Secure/i.test(cookie)).toBe(env.AUTH_COOKIE_SECURE);
    }
    // La de acceso es de sesión (sin Max-Age); la de refresh persiste.
    expect(access).not.toMatch(/Max-Age/i);
    expect(refresh).toMatch(/Max-Age=\d+/i);
  });

  it('reto de PIN: sin cookies y sin tokens', async () => {
    auth.login.mockImplementationOnce(
      async () => ({ pinChallengeRequired: true, challengeToken: 'challenge-not-a-secret', expiresIn: '5m' }) as never,
    );
    const response = await request(app.getHttpServer())
      .post('/internal/auth/login')
      .set('x-tenant-id', '1')
      .send({ email: 'ops@example.test', password: 'p' });
    expect(response.status).toBe(200);
    expect(cookies(response)).toEqual([]);
    expect(response.body).not.toHaveProperty('accessToken');
  });

  it('logout: borra ambas cookies con los mismos atributos de emisión', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/auth/logout')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=test-refresh-token-not-a-secret`)
      .send({});
    expect(response.status).toBe(200);
    const set = cookies(response);
    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      const cleared = set.find((cookie) => cookie.startsWith(`${name}=`));
      expect(cleared).toBeDefined();
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
      expect(cleared).toMatch(/Path=\//);
    }
  });
});
