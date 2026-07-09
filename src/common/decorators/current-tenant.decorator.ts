import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithAuth } from '../types/auth.types.js';
import { parsePositiveId } from '../utils/ids/id.util.js';

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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
  const headerValue = firstHeader(request.headers['x-tenant-id']);
  const raw = headerValue ?? request.user?.tenantId;
  return parsePositiveId(String(raw ?? ''), 'x-tenant-id');
});
