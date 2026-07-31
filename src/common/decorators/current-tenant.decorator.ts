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
export const CurrentTenant = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<RequestWithAuth>();
  const headerValue = firstHeaderValue(request.headers['x-tenant-id']);
  const raw = headerValue ?? request.user?.tenantId;
  return parsePositiveId(String(raw ?? ''), 'x-tenant-id');
});
