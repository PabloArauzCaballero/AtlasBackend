/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de http sin introducir reglas de un dominio específico.
 */
import { env } from '../../../config/env.js';

/**
 * Cookies de sesión interna.
 *
 * El panel administrativo dejó de recibir los tokens en el body: viajan en cookies `HttpOnly`, de
 * modo que un XSS en el portal ya no puede leerlos desde JavaScript. El header `Authorization`
 * sigue aceptándose (ver `JwtAuthGuard`) porque los clientes no-navegador —smoke tests, scripts,
 * herramientas internas— no tienen dónde guardar una cookie.
 */
export const ACCESS_TOKEN_COOKIE = 'atlas_internal_access';
export const REFRESH_TOKEN_COOKIE = 'atlas_internal_refresh';

/** Forma mínima que necesita la lectura: sirve tanto para RequestWithAuth como RequestWithNetwork. */
export type RequestWithCookies = { headers: Record<string, string | string[] | undefined> };

/**
 * Tipo estructural en vez de `Response` de express: el repo no depende de `@types/express` y ya
 * usa esta convención (ver `ExpressLikeResponse` en metrics.controller.ts).
 */
export type ResponseWithCookies = {
  cookie: (name: string, value: string, options: CookieOptions) => unknown;
  clearCookie: (name: string, options: CookieOptions) => unknown;
};

export type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  domain?: string;
  maxAge?: number;
};

/**
 * Lee una cookie sin depender de `cookie-parser`. Express no parsea cookies por defecto y añadir
 * la dependencia solo para esto no se justifica: `res.cookie()` (escritura) sí es nativo de
 * Express, así que lo único que faltaba era la lectura.
 */
export function readCookie(request: RequestWithCookies, name: string): string | null {
  const header = request.headers.cookie;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;

  for (const part of raw.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    if (part.slice(0, separatorIndex).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim()) || null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * `SameSite` por defecto es `lax` y es correcto pese a que el portal (5273) y la API (3005) sean
 * orígenes distintos: SameSite se decide por dominio registrable, no por puerto, así que ambos son
 * el MISMO site y la cookie viaja igual. Y al ser `lax`, un sitio de terceros no puede disparar
 * mutaciones autenticadas: es la protección CSRF.
 *
 * Si algún despliegue deja portal y API en dominios distintos (sites distintos), hay que poner
 * `AUTH_COOKIE_SAMESITE=none`, que EXIGE `Secure` y deja de proteger contra CSRF por sí solo: en
 * ese escenario hay que activar además el token CSRF.
 */
/**
 * De dónde sale el token de sesión de una petición, definido UNA sola vez.
 *
 * La cookie `HttpOnly` tiene prioridad sobre `Authorization`: es la vía del panel interno y la que
 * un XSS no puede leer. El header se mantiene como respaldo para clientes que no son navegador
 * (smokes, scripts, integraciones), que no tienen dónde guardar una cookie.
 *
 * Vive aquí, junto a los nombres de cookie, porque hay más de un consumidor: el guard que valida la
 * sesión y el decorador que la REENVÍA al motor de decisión. Dos copias de «dónde está el token» se
 * separan con el tiempo, y el día que se separen una de las dos autenticará distinto que la otra.
 *
 * Devuelve `null` cuando no hay token; decidir si eso es un 401 es del guard, no de esta función.
 */
export function readAccessToken(request: RequestWithCookies): string | null {
  const fromCookie = readCookie(request, ACCESS_TOKEN_COOKIE);
  if (fromCookie) return fromCookie;

  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;

  const [scheme, token] = value.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

export function buildAuthCookieOptions(maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    path: '/',
    ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}
