/**
 * @file Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de decorators sin introducir reglas de un dominio específico.
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithAuth } from '../types/auth.types.js';
import { readAccessToken } from '../utils/http/auth-cookies.util.js';

/**
 * El token de sesión CRUDO de quien hace la petición, para reenviarlo a un servicio hermano.
 *
 * Existe para un caso muy concreto y deliberadamente estrecho: el motor de decisión trata a este
 * backend como su PROVEEDOR DE IDENTIDAD —verifica cada token llamando a `/internal/auth/me`— así
 * que la forma correcta de pedirle algo en nombre de una persona es llevar su token, no una llave
 * de servicio. Con una llave, el motor vería «Atlas» donde debería ver a quien pulsó el botón, y
 * su propio control de roles dejaría de aplicar a esa persona.
 *
 * `@CurrentUser()` no sirve aquí: entrega el token YA DECODIFICADO, y lo que hace falta es la
 * cadena firmada que el otro servicio pueda verificar por su cuenta.
 *
 * Sólo tiene sentido tras `JwtAuthGuard`; en una ruta pública devuelve `null`.
 */
export const AccessToken = createParamDecorator((_: unknown, context: ExecutionContext): string | null => {
  const request = context.switchToHttp().getRequest<RequestWithAuth>();
  return readAccessToken(request);
});
