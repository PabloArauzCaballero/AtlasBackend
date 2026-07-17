import { describe, expect, it } from '@jest/globals';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  buildAuthCookieOptions,
  readCookie,
} from '../../../../src/common/utils/http/auth-cookies.util.js';

/**
 * Lectura de cookies sin `cookie-parser`. Es la puerta de entrada de la sesion del panel interno:
 * si esto falla en silencio, el guard no encuentra el token y el portal queda sin autenticar.
 */
function requestWith(cookieHeader: string | undefined) {
  return { headers: cookieHeader === undefined ? {} : { cookie: cookieHeader } };
}

describe('readCookie', () => {
  it('lee una cookie unica', () => {
    expect(readCookie(requestWith(`${ACCESS_TOKEN_COOKIE}=abc123`), ACCESS_TOKEN_COOKIE)).toBe('abc123');
  });

  it('lee una cookie entre varias', () => {
    const header = `otra=1; ${ACCESS_TOKEN_COOKIE}=abc123; ${REFRESH_TOKEN_COOKIE}=def456`;
    expect(readCookie(requestWith(header), REFRESH_TOKEN_COOKIE)).toBe('def456');
  });

  it('tolera espacios alrededor del separador', () => {
    expect(readCookie(requestWith(`  ${ACCESS_TOKEN_COOKIE}=abc123  `), ACCESS_TOKEN_COOKIE)).toBe('abc123');
  });

  it('decodifica valores percent-encoded', () => {
    expect(readCookie(requestWith(`${ACCESS_TOKEN_COOKIE}=a%2Bb%3Dc`), ACCESS_TOKEN_COOKIE)).toBe('a+b=c');
  });

  it('no confunde una cookie cuyo nombre es prefijo de otra', () => {
    const header = `${ACCESS_TOKEN_COOKIE}_backup=malo; ${ACCESS_TOKEN_COOKIE}=bueno`;
    expect(readCookie(requestWith(header), ACCESS_TOKEN_COOKIE)).toBe('bueno');
  });

  it('devuelve null si la cookie no esta', () => {
    expect(readCookie(requestWith('otra=1'), ACCESS_TOKEN_COOKIE)).toBeNull();
  });

  it('devuelve null si no hay header cookie', () => {
    expect(readCookie(requestWith(undefined), ACCESS_TOKEN_COOKIE)).toBeNull();
  });

  it('devuelve null si la cookie esta vacia', () => {
    expect(readCookie(requestWith(`${ACCESS_TOKEN_COOKIE}=`), ACCESS_TOKEN_COOKIE)).toBeNull();
  });

  it('ignora fragmentos sin signo igual', () => {
    expect(readCookie(requestWith(`basura; ${ACCESS_TOKEN_COOKIE}=ok`), ACCESS_TOKEN_COOKIE)).toBe('ok');
  });
});

describe('buildAuthCookieOptions', () => {
  it('siempre marca httpOnly: es lo que impide que un XSS lea el token', () => {
    expect(buildAuthCookieOptions().httpOnly).toBe(true);
  });

  it('usa path raiz para que la cookie viaje a toda la API', () => {
    expect(buildAuthCookieOptions().path).toBe('/');
  });

  it('sin maxAge la cookie es de sesion', () => {
    expect(buildAuthCookieOptions().maxAge).toBeUndefined();
  });

  it('propaga maxAge cuando se pide persistencia', () => {
    expect(buildAuthCookieOptions(60_000).maxAge).toBe(60_000);
  });

  it('sameSite nunca queda sin valor', () => {
    expect(['lax', 'strict', 'none']).toContain(buildAuthCookieOptions().sameSite);
  });
});
