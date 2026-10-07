/**
 * @file Guard: aplica autenticación o autorización antes del caso de uso.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { INTERNAL_PERMISSIONS_KEY } from '../decorators/internal-permissions.decorator.js';
import { RequestWithAuth } from '../types/auth.types.js';
import { INTERNAL_PERMISSIONS_CHECKER, InternalPermissionsChecker } from './internal-permissions.port.js';

@Injectable()
export class InternalPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(INTERNAL_PERMISSIONS_CHECKER) private readonly rbacRepository: InternalPermissionsChecker,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(INTERNAL_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = request.user;
    if (!user?.tenantId || !user.internalUserId) {
      throw new ForbiddenException('Esta operación requiere una sesión interna.');
    }

    const hasAccess = await this.rbacRepository.hasPermissions(user.tenantId, user.internalUserId, requiredPermissions);
    if (!hasAccess) {
      // Se nombra el permiso: el ERP y el portal conceden sus botones por ROL y aquí se decide por
      // PERMISO; sin el código nadie sabía qué pedir ni a quién (ver `ROLE_PERMISSION_CODES`).
      throw new ForbiddenException(
        `El usuario interno no tiene los permisos requeridos para esta operación: ${requiredPermissions.join(', ')}.`,
      );
    }

    return true;
  }
}
