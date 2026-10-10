/**
 * @file APP-02 — sesión del cliente en modo cookie, contra el `AuthController` real.
 * @business La web del cliente deja de guardar tokens en `localStorage`: el refresh token viaja sólo en una
 *   cookie `HttpOnly; SameSite=Strict` limitada a refresh/logout. El teléfono, que no pide el modo cookie,
 *   sigue recibiendo el par de tokens en el cuerpo exactamente como antes.
 * @system supertest sobre `AuthController` con guards reales y `AuthService` doble (tokens de prueba, sin
 *   secretos). Se asertan nombres, atributos y presencia, no valores.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../src/common/services/token-revocation.service.js';
import { env } from '../../../src/config/env.js';
import { AuthCredentialsService } from '../../../src/modules/auth/auth-credentials.service.js';
import { AuthController } from '../../../src/modules/auth/auth.controller.js';
import { AuthService } from '../../../src/modules/auth/auth.service.js';
import {
  CUSTOMER_REFRESH_COOKIE,
  SESSION_MODE_HEADER,
  arrivedOverHttps,
  customerRefreshCookiePaths,
  isTrustedOrigin,
} from '../../../src/modules/auth/customer-session-cookie.js';

const TOKENS = {
  accessToken: 'test-access-token-not-a-secret',
  refreshToken: 'test-refresh-token-not-a-secret-rotated',
  tokenType: 'Bearer',
  expiresIn: '15m',
};
const OLD_REFRESH = 'test-refresh-token-not-a-secret-previous';
const PREFIX = `/${env.API_PREFIX}`;
const SAME_ORIGIN = { host: 'atlas.consumerweb.test.example', origin: 'https://atlas.consumerweb.test.example' };

describe('APP-02 · sesión del cliente en modo cookie', () => {
  let app: INestApplication;
  const auth = {
    login: jest.fn(async (..._args: unknown[]) => ({ ...TOKENS }) as object),
    verifyLoginPin: jest.fn(async (..._args: unknown[]) => ({ ...TOKENS })),
    refresh: jest.fn(async (..._args: unknown[]) => ({ ...TOKENS })),
    logout: jest.fn(async (..._args: unknown[]) => ({ loggedOut: true })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        JwtAuthGuard,
        TenantGuard,
        RolesGuard,
        { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn(async () => null) } },
        { provide: AuthService, useValue: auth },
        { provide: AuthCredentialsService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(env.API_PREFIX);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const cookies = (response: request.Response): string[] =>
    ([] as string[]).concat((response.headers['set-cookie'] as unknown as string[]) ?? []);
  const refreshCookies = (response: request.Response) => cookies(response).filter((c) => c.startsWith(`${CUSTOMER_REFRESH_COOKIE}=`));
  const post = (path: string) => request(app.getHttpServer()).post(`${PREFIX}${path}`);
  const cookieMode = (req: request.Test, origin = SAME_ORIGIN) =>
    req.set(SESSION_MODE_HEADER, 'cookie').set('Host', origin.host).set('Origin', origin.origin);

  describe('sin la cabecera de modo (la app del teléfono): nada cambia', () => {
    it('login devuelve el par de tokens en el cuerpo y no emite cookies', async () => {
      const response = await post('/auth/login')
        .set('x-tenant-id', '1')
        .send({ actorType: 'customer', identifier: 'cliente@example.test', password: 'p' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ accessToken: TOKENS.accessToken, refreshToken: TOKENS.refreshToken });
      expect(cookies(response)).toEqual([]);
    });

    it('refresh exige el token en el cuerpo (400 sin él) y no emite cookies', async () => {
      const missing = await post('/auth/refresh').send({});
      expect(missing.status).toBe(400);
      expect(auth.refresh).not.toHaveBeenCalled();

      const ok = await post('/auth/refresh').send({ refreshToken: OLD_REFRESH });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ refreshToken: TOKENS.refreshToken });
      expect(auth.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: OLD_REFRESH }));
      expect(cookies(ok)).toEqual([]);
    });

    it('una cookie de cliente sin la cabecera se IGNORA: manda el cuerpo', async () => {
      const response = await post('/auth/refresh')
        .set('Cookie', `${CUSTOMER_REFRESH_COOKIE}=${OLD_REFRESH}-cookie`)
        .send({ refreshToken: OLD_REFRESH });
      expect(response.status).toBe(200);
      expect(auth.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: OLD_REFRESH }));
    });

    it('logout exige el token en el cuerpo y no toca cookies', async () => {
      expect((await post('/auth/logout').send({})).status).toBe(400);
      const response = await post('/auth/logout').send({ refreshToken: OLD_REFRESH });
      expect(response.status).toBe(200);
      expect(auth.logout).toHaveBeenCalledWith({ refreshToken: OLD_REFRESH, allDevices: false });
      expect(cookies(response)).toEqual([]);
    });
  });

  describe('con `x-atlas-session-mode: cookie` (la web del cliente)', () => {
    it('login: el refresh token sale del cuerpo y entra en una cookie HttpOnly, Strict, limitada a refresh y logout', async () => {
      const response = await cookieMode(post('/auth/login'))
        .set('x-tenant-id', '1')
        .send({ actorType: 'customer', identifier: 'cliente@example.test', password: 'p' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ accessToken: TOKENS.accessToken, sessionMode: 'cookie' });
      expect(response.body).not.toHaveProperty('refreshToken');

      const set = refreshCookies(response);
      expect(set.map((cookie) => /Path=([^;]+)/i.exec(cookie)?.[1]).sort()).toEqual(customerRefreshCookiePaths().sort());
      expect(customerRefreshCookiePaths()).toEqual([`${PREFIX}/auth/refresh`, `${PREFIX}/auth/logout`]);
      for (const cookie of set) {
        expect(cookie).toContain(`${CUSTOMER_REFRESH_COOKIE}=${TOKENS.refreshToken}`);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Strict/i);
        expect(cookie).toMatch(/Max-Age=\d+/i);
        expect(cookie).toMatch(/; Secure/i);
      }
      // El token de acceso NUNCA va en cookie: vive en la memoria de la página.
      expect(cookies(response).every((cookie) => cookie.startsWith(`${CUSTOMER_REFRESH_COOKIE}=`))).toBe(true);
    });

    it('por http (la web de TEST en la IP) la cookie no puede ser Secure: el navegador no la guardaría', async () => {
      const response = await cookieMode(post('/auth/login'), { host: '161.97.85.216', origin: 'http://161.97.85.216' })
        .set('x-tenant-id', '1')
        .send({ actorType: 'customer', identifier: 'cliente@example.test', password: 'p' });
      expect(response.status).toBe(200);
      const set = refreshCookies(response);
      expect(set).toHaveLength(2);
      for (const cookie of set) {
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Strict/i);
        expect(cookie).not.toMatch(/; Secure/i);
      }
    });

    it('reto de PIN del login: sin cookie y el cuerpo intacto', async () => {
      auth.login.mockImplementationOnce(async () => ({ pinChallengeRequired: true, challengeToken: 'challenge-not-a-secret' }));
      const response = await cookieMode(post('/auth/login'))
        .set('x-tenant-id', '1')
        .send({ actorType: 'customer', identifier: 'cliente@example.test', password: 'p' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ pinChallengeRequired: true });
      expect(cookies(response)).toEqual([]);
    });

    it('login/pin también emite la cookie', async () => {
      const response = await cookieMode(post('/auth/login/pin')).send({ challengeToken: 'challenge-not-a-secret-xx', pin: '123456' });
      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('refreshToken');
      expect(refreshCookies(response)).toHaveLength(2);
    });

    it('refresh: lee la cookie (no el cuerpo), la rota y no devuelve el refresh token', async () => {
      const response = await cookieMode(post('/auth/refresh')).set('Cookie', `${CUSTOMER_REFRESH_COOKIE}=${OLD_REFRESH}`).send({});
      expect(response.status).toBe(200);
      expect(auth.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: OLD_REFRESH }));
      expect(response.body).toMatchObject({ accessToken: TOKENS.accessToken, sessionMode: 'cookie' });
      expect(response.body).not.toHaveProperty('refreshToken');
      expect(refreshCookies(response).every((cookie) => cookie.includes(TOKENS.refreshToken))).toBe(true);
    });

    it('migración: sin cookie, acepta UNA vez el token viejo del cuerpo y pasa a cookie', async () => {
      const response = await cookieMode(post('/auth/refresh')).send({ refreshToken: OLD_REFRESH });
      expect(response.status).toBe(200);
      expect(auth.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: OLD_REFRESH }));
      expect(response.body).not.toHaveProperty('refreshToken');
      expect(refreshCookies(response)).toHaveLength(2);
    });

    it('refresh sin cookie ni cuerpo: 401 (no hay sesión que recuperar)', async () => {
      const response = await cookieMode(post('/auth/refresh')).send({});
      expect(response.status).toBe(401);
      expect(auth.refresh).not.toHaveBeenCalled();
    });

    it('refresh rechazado por el servidor: 401 y la cookie se borra', async () => {
      auth.refresh.mockImplementationOnce(async () => {
        throw new UnauthorizedException('Refresh token inválido.');
      });
      const response = await cookieMode(post('/auth/refresh')).set('Cookie', `${CUSTOMER_REFRESH_COOKIE}=${OLD_REFRESH}`).send({});
      expect(response.status).toBe(401);
      const set = refreshCookies(response);
      expect(set).toHaveLength(2);
      for (const cookie of set) expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    });

    it('sesión pasada de su tope absoluto: 401 SESSION_EXPIRED y la cookie se borra en las dos rutas', async () => {
      auth.refresh.mockImplementationOnce(async () => {
        throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'La sesión superó su duración máxima.' });
      });
      const response = await cookieMode(post('/auth/refresh')).set('Cookie', `${CUSTOMER_REFRESH_COOKIE}=${OLD_REFRESH}`).send({});
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'SESSION_EXPIRED' });
      const set = refreshCookies(response);
      expect(set.map((cookie) => /Path=([^;]+)/i.exec(cookie)?.[1]).sort()).toEqual(customerRefreshCookiePaths().sort());
      for (const cookie of set) expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    });

    it('la cookie no sobrevive al tope de la sesión: Max-Age de como mucho esas horas', async () => {
      const response = await cookieMode(post('/auth/refresh')).set('Cookie', `${CUSTOMER_REFRESH_COOKIE}=${OLD_REFRESH}`).send({});
      for (const cookie of refreshCookies(response)) {
        const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1]);
        expect(maxAge).toBeLessThanOrEqual(env.AUTH_CUSTOMER_SESSION_ABSOLUTE_MAX_HOURS * 3600);
      }
    });

    it('CSRF: sin Origin, o con un Origin ajeno, el refresh se rechaza (403) sin tocar el token', async () => {
      const sinOrigin = await post('/auth/refresh')
        .set(SESSION_MODE_HEADER, 'cookie')
        .set('Cookie', `${CUSTOMER_REFRESH_COOKIE}=${OLD_REFRESH}`)
        .send({});
      expect(sinOrigin.status).toBe(403);
      const ajeno = await cookieMode(post('/auth/refresh'), { host: SAME_ORIGIN.host, origin: 'https://evil.example' })
        .set('Cookie', `${CUSTOMER_REFRESH_COOKIE}=${OLD_REFRESH}`)
        .send({});
      expect(ajeno.status).toBe(403);
      expect(auth.refresh).not.toHaveBeenCalled();
    });

    it('logout: revoca el token de la cookie y la borra en las dos rutas', async () => {
      const response = await cookieMode(post('/auth/logout')).set('Cookie', `${CUSTOMER_REFRESH_COOKIE}=${OLD_REFRESH}`).send({});
      expect(response.status).toBe(200);
      expect(auth.logout).toHaveBeenCalledWith({ refreshToken: OLD_REFRESH, allDevices: false });
      const set = refreshCookies(response);
      expect(set.map((cookie) => /Path=([^;]+)/i.exec(cookie)?.[1]).sort()).toEqual(customerRefreshCookiePaths().sort());
      for (const cookie of set) expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    });

    it('logout sin cookie: no falla, borra igual y no llama al servicio', async () => {
      const response = await cookieMode(post('/auth/logout')).send({});
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ loggedOut: true });
      expect(auth.logout).not.toHaveBeenCalled();
      expect(refreshCookies(response)).toHaveLength(2);
    });
  });

  describe('reglas de origen y de esquema', () => {
    const req = (headers: Record<string, string>, secure?: boolean) => ({ headers, secure });

    it('acepta un origen de la lista de CORS aunque no sea el mismo host', () => {
      const [primero] = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
      expect(isTrustedOrigin(req({ origin: primero!, host: 'api.example.test' }))).toBe(true);
    });

    it('rechaza un Origin malformado o ausente', () => {
      expect(isTrustedOrigin(req({ origin: 'no es una url', host: 'x' }))).toBe(false);
      expect(isTrustedOrigin(req({ host: 'x' }))).toBe(false);
    });

    it('el mismo host con OTRO puerto no es el mismo origen', () => {
      expect(isTrustedOrigin(req({ origin: 'http://161.97.85.216:8080', host: '161.97.85.216' }))).toBe(false);
    });

    it('https se detecta por Origin, por X-Forwarded-Proto o por la conexión', () => {
      expect(arrivedOverHttps(req({ origin: 'https://a.example' }))).toBe(true);
      expect(arrivedOverHttps(req({ 'x-forwarded-proto': 'https, http' }))).toBe(true);
      expect(arrivedOverHttps(req({}, true))).toBe(true);
      expect(arrivedOverHttps(req({ origin: 'http://161.97.85.216', 'x-forwarded-proto': 'http' }))).toBe(false);
    });
  });
});
