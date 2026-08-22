/**
 * @file Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de decorators sin introducir reglas de un dominio específico.
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithAuth } from '../types/auth.types.js';
import { parsePositiveId } from '../utils/ids/id.util.js';
import { firstHeaderValue } from '../utils/http/headers.util.js';

/**
 * Reemplaza el patrón repetido en ~17 controllers de `@Headers('x-tenant-id') tenantIdHeader` +
 * `parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id')`. `TenantGuard` (ver
 * `src/common/guards/tenant.guard.ts`) ya garantiza que, si el token trae `tenantId`, el header
 * enviado coincide con él — este decorador solo centraliza de dónde sale el valor final: header
 * si vino, si no `request.user.tenantId` (para actores sin header explícito), y 400 si ninguno
 * de los dos existe.
 */
/**
 * La resolución, separada del decorador para poder probarla.
 *
 * Un decorador de parámetro de Nest no es invocable a mano: su factoría se guarda en la metadata de
 * la ruta y solo la ejecuta el framework. Con la regla en una función pura, el 400 —la garantía de
 * que ninguna consulta corre sin frontera de tenant— se prueba directamente.
 */
export function resolveCurrentTenant(request: RequestWithAuth): string {
  const headerValue = firstHeaderValue(request.headers['x-tenant-id']);
  const raw = headerValue ?? request.user?.tenantId;
  return parsePositiveId(String(raw ?? ''), 'x-tenant-id');
}

export const CurrentTenant = createParamDecorator((_: unknown, context: ExecutionContext): string =>
  resolveCurrentTenant(context.switchToHttp().getRequest<RequestWithAuth>()),
);
