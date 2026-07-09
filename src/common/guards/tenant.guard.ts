import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestWithAuth } from '../types/auth.types.js';

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Los tokens de `customer` e `internal_user` llevan `tenantId` (ver `AuthService`/`InternalAuthService`);
 * los de `platform_user` no, porque ese actor opera a nivel plataforma sobre cualquier tenant. Varios
 * controladores reciben además `x-tenant-id` por header y lo usan directamente para filtrar consultas
 * (`parsePositiveId(tenantIdHeader, ...)`), sin comparar ese valor contra el tenant real del token —
 * un actor autenticado en el tenant A podía enviar `x-tenant-id: B` y operar sobre datos del tenant B.
 * Este guard cierra ese hueco: si el token trae `tenantId`, el header (cuando se envía) debe coincidir.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = request.user;
    if (!user || !user.tenantId) {
      return true;
    }

    const headerTenantId = firstHeader(request.headers['x-tenant-id']);
    if (headerTenantId !== undefined && headerTenantId !== '' && headerTenantId !== user.tenantId) {
      throw new ForbiddenException('El x-tenant-id indicado no coincide con el tenant del token autenticado.');
    }

    return true;
  }
}
