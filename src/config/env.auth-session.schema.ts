/**
 * @file Vigencias de la sesión: cuánto vive el refresh token y, para el cliente, el tope absoluto de la sesión.
 * @business La sesión del cliente dura lo que exige el estándar bancario: un acceso corto y un tope desde el último inicio de sesión.
 * @system declara `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS`, `AUTH_CUSTOMER_SESSION_ABSOLUTE_MAX_HOURS` y `AUTH_CUSTOMER_ACCESS_TOKEN_TTL_MINUTES`.
 */
import { z } from 'zod';

export const authSessionEnvShape = {
  AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * Horas que puede durar, como mucho, una sesión del CLIENTE contadas desde su último inicio de sesión con
   * credenciales (contraseña o PIN). Rotar el refresh token no reinicia el reloj; pasado el tope, `/auth/refresh`
   * responde 401 `SESSION_EXPIRED` y revoca la sesión. Portales internos y comercio no se ven afectados.
   */
  AUTH_CUSTOMER_SESSION_ABSOLUTE_MAX_HOURS: z.coerce.number().int().positive().max(24).default(8),
  /**
   * Vida del token de acceso del CLIENTE. Corto a propósito: es un portador y no se puede revocar uno a uno; 15 min
   * acota lo que vale uno robado y lo que una sesión puede pasarse de su tope. El techo de 15 es la política, no un
   * valor más que se pueda subir por entorno.
   */
  AUTH_CUSTOMER_ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(15).default(15),
} as const;
