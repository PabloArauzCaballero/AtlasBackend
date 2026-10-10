/**
 * @file Modo cookie de la sesión del cliente: el refresh token viaja en una cookie `HttpOnly` y no en el cuerpo.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { BadRequestException, ForbiddenException, UnauthorizedException, applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { CookieOptions, RequestWithCookies, ResponseWithCookies, readCookie } from '../../common/utils/http/auth-cookies.util.js';
import { env, getAllowedCorsOrigins } from '../../config/env.js';

/**
 * Sesión del cliente en modo cookie (APP-02).
 *
 * La app del cliente servida en el NAVEGADOR guardaba el access y el refresh token en `localStorage`,
 * legibles por cualquier XSS. En modo cookie el refresh token sólo existe en una cookie `HttpOnly`
 * que JavaScript no puede leer, y el access token vive en la memoria de la página.
 *
 * Es OPT-IN por petición (cabecera `x-atlas-session-mode: cookie`): la app del teléfono no la manda
 * y sigue recibiendo el par de tokens en el cuerpo, como siempre. Reutiliza `readCookie` y la forma
 * de `res.cookie` del panel interno y del comercio; lo que cambia es el alcance de la cookie:
 *
 *  - `Path` = sólo `…/auth/refresh` y `…/auth/logout` (una cookie por ruta, mismo valor): el token de
 *    refresco no viaja en ninguna otra petición del API;
 *  - `SameSite=Strict`: la web y su API comparten origen (nginx reenvía `/api/v1`);
 *  - `Secure` cuando la petición llegó por https. La web de TEST también se sirve por http en la IP
 *    del VPS (`http://161.97.85.216`, porque FortiGuard bloquea `*.sslip.io`): ahí una cookie `Secure`
 *    no se guardaría y la sesión no sobreviviría a una recarga. El compromiso: por http la cookie
 *    viaja en claro, igual que el resto del tráfico de ese acceso; sigue siendo `HttpOnly` (un XSS no
 *    la lee) y `Strict` (ningún otro sitio la dispara).
 *
 * CSRF: además de `SameSite=Strict`, toda petición en modo cookie debe traer `Origin` y ese origen
 * tiene que estar en la lista de CORS o ser el MISMO origen que la petición (la web y el API van por
 * el mismo host). La cabecera de modo, al ser propia, obliga además a un preflight entre orígenes.
 */
export const SESSION_MODE_HEADER = 'x-atlas-session-mode';
export const CUSTOMER_REFRESH_COOKIE = 'atlas_customer_refresh';

type SessionRequest = RequestWithCookies & { secure?: boolean };
type TokenResult = { refreshToken?: string };

function header(request: SessionRequest, name: string): string | null {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}

/** Las dos rutas que consumen la cookie, con el prefijo global del API (`/api/v1`). */
export function customerRefreshCookiePaths(): string[] {
  const prefix = `/${env.API_PREFIX.replace(/^\/+|\/+$/g, '')}`;
  return [`${prefix}/auth/refresh`, `${prefix}/auth/logout`];
}

export function wantsCookieSession(request: SessionRequest): boolean {
  return header(request, SESSION_MODE_HEADER)?.toLowerCase() === 'cookie';
}

/**
 * ¿Llegó por https? El `Origin` dice el esquema con el que el navegador habló; detrás de dos proxies
 * (Traefik termina el TLS y el nginx de la web reescribe `X-Forwarded-Proto` con su propio `$scheme`)
 * es la señal fiable. Falsearlo sólo cambia la cookie de quien lo falsea.
 */
export function arrivedOverHttps(request: SessionRequest): boolean {
  if (header(request, 'origin')?.toLowerCase().startsWith('https://')) return true;
  if (header(request, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() === 'https') return true;
  return request.secure === true;
}

export function isTrustedOrigin(request: SessionRequest): boolean {
  const origin = header(request, 'origin');
  if (!origin) return false;
  if (getAllowedCorsOrigins().includes(origin)) return true;
  try {
    return new URL(origin).host === header(request, 'host');
  } catch {
    return false;
  }
}

export function assertTrustedOrigin(request: SessionRequest): void {
  if (!isTrustedOrigin(request)) throw new ForbiddenException('SESSION_ORIGIN_NOT_ALLOWED: el origen de la petición no está autorizado.');
}

function cookieOptions(request: SessionRequest, path: string, maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: arrivedOverHttps(request),
    sameSite: 'strict',
    path,
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}

export function clearCustomerRefreshCookie(request: SessionRequest, response: ResponseWithCookies): void {
  for (const path of customerRefreshCookiePaths()) response.clearCookie(CUSTOMER_REFRESH_COOKIE, cookieOptions(request, path));
}

/**
 * Aplica el modo de sesión a una respuesta con tokens. Sin la cabecera, la respuesta sale intacta (el
 * teléfono). Con ella, el refresh token pasa a la cookie y desaparece del cuerpo. Una respuesta sin
 * refresh token —el desafío de PIN del login— no toca la cookie.
 */
export function applyCustomerSessionMode<T extends object>(request: SessionRequest, response: ResponseWithCookies, result: T): T {
  if (!wantsCookieSession(request)) return result;
  const { refreshToken, ...rest } = result as T & TokenResult;
  if (!refreshToken) return result;
  // La cookie es sólo del cliente: no tiene sentido que sobreviva al tope absoluto de su sesión (el servidor lo
  // aplica igual; esto sólo evita que el navegador guarde 30 días una cookie que a las pocas horas ya no vale).
  const maxAgeMs = Math.min(env.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24, env.AUTH_CUSTOMER_SESSION_ABSOLUTE_MAX_HOURS) * 60 * 60 * 1000;
  for (const path of customerRefreshCookiePaths()) {
    response.cookie(CUSTOMER_REFRESH_COOKIE, refreshToken, cookieOptions(request, path, maxAgeMs));
  }
  return { ...rest, sessionMode: 'cookie' } as unknown as T;
}

/**
 * De dónde sale el refresh token de un refresco o de un cierre de sesión.
 *
 * Modo cookie: origen verificado y la cookie manda; el cuerpo sólo se acepta como respaldo, para la
 * MIGRACIÓN de la web (encuentra el par viejo en `localStorage`, lo canjea una vez y pasa a cookie).
 * Sin modo cookie: el cuerpo, como siempre — y sin él, el mismo 400 que daba el esquema.
 */
export function resolveRefreshToken(request: SessionRequest, fromBody: string | undefined): string | null {
  if (wantsCookieSession(request)) {
    assertTrustedOrigin(request);
    return readCookie(request, CUSTOMER_REFRESH_COOKIE) ?? fromBody ?? null;
  }
  if (fromBody) return fromBody;
  throw new BadRequestException({
    message: 'Entrada inválida en body.',
    issues: [{ path: 'refreshToken', message: 'Required' }],
  });
}

/** El refresh token de un refresco: sin cookie ni cuerpo en modo cookie es un 401 (no hay sesión que renovar). */
export function refreshTokenFor(request: SessionRequest, fromBody: string | undefined): string {
  const token = resolveRefreshToken(request, fromBody);
  if (!token) throw new UnauthorizedException('REFRESH_TOKEN_MISSING: no llegó la cookie de sesión ni un token en el cuerpo.');
  return token;
}

/**
 * Cierre de sesión. En modo cookie la cookie se borra SIEMPRE, también cuando ya no había token que
 * revocar: cerrar sesión no puede fallar por llegar sin sesión.
 */
export async function logoutWithCustomerSessionMode<T>(
  request: SessionRequest,
  response: ResponseWithCookies,
  fromBody: string | undefined,
  revoke: (refreshToken: string) => Promise<T>,
): Promise<T | { loggedOut: true }> {
  const refreshToken = resolveRefreshToken(request, fromBody);
  if (wantsCookieSession(request)) clearCustomerRefreshCookie(request, response);
  return refreshToken ? revoke(refreshToken) : { loggedOut: true };
}

/** Documenta la cabecera opcional en las cuatro rutas que la entienden. */
export function ApiCustomerSessionMode(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiHeader({
      name: SESSION_MODE_HEADER,
      required: false,
      description:
        '`cookie` (sólo la web del cliente): el refresh token viaja en la cookie HttpOnly `atlas_customer_refresh` ' +
        '(SameSite=Strict, Path=/api/v1/auth/refresh y /api/v1/auth/logout) y no en el cuerpo. Exige `Origin` permitido.',
    }),
  );
}

/**
 * Corre un refresco y aplica el modo de sesión. Si el servidor RECHAZA el token en modo cookie, la
 * cookie se borra en la misma respuesta: una cookie que ya no vale sólo provocaría otro 401 en cada
 * recarga.
 */
export async function withCustomerSessionMode<T extends object>(
  request: SessionRequest,
  response: ResponseWithCookies,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return applyCustomerSessionMode(request, response, await run());
  } catch (error) {
    if (wantsCookieSession(request) && error instanceof UnauthorizedException) clearCustomerRefreshCookie(request, response);
    throw error;
  }
}
