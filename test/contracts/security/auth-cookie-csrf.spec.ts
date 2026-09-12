/**
 * @file AT-047 — contrato de cookies de sesión interna: atributos que el portal aprobó no cambian.
 * @business Las cookies de acceso/refresco son httpOnly, con `secure` y `sameSite` gobernados por
 *   configuración y sin dominio salvo que se configure; el nombre es estable para el frontend.
 * @system `buildAuthCookieOptions` y los nombres exportados; `readAccessToken` sólo lee la cookie de acceso.
 */
import { describe, expect, it } from '@jest/globals';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  buildAuthCookieOptions,
  readAccessToken,
  readCookie,
} from '../../../src/common/utils/http/auth-cookies.util.js';
import { env } from '../../../src/config/env.js';

describe('cookies de sesión (AT-047)', () => {
  it('nombres estables y atributos gobernados por configuración', () => {
    expect(ACCESS_TOKEN_COOKIE).toBe('atlas_internal_access');
    expect(REFRESH_TOKEN_COOKIE).toBe('atlas_internal_refresh');
    const options = buildAuthCookieOptions(60_000);
    expect(options).toMatchObject({
      httpOnly: true,
      secure: env.AUTH_COOKIE_SECURE,
      sameSite: env.AUTH_COOKIE_SAMESITE,
      path: '/',
      maxAge: 60_000,
    });
    if (!env.AUTH_COOKIE_DOMAIN) expect('domain' in options).toBe(false);
  });

  it('el token de acceso se lee sólo de su cookie; una cookie ajena no cuenta', () => {
    const request = { headers: { cookie: `${REFRESH_TOKEN_COOKIE}=r; ${ACCESS_TOKEN_COOKIE}=a` } };
    expect(readAccessToken(request)).toBe('a');
    expect(readCookie({ headers: { cookie: 'otra=x' } }, ACCESS_TOKEN_COOKIE)).toBeNull();
  });
});
