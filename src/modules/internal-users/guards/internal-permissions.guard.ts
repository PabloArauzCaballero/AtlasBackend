/**
 * @file Guard: aplica autenticación o autorización antes del caso de uso.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { INTERNAL_PERMISSIONS_KEY } from '../internal-permissions.decorator.js';
import { RequestWithAuth } from '../../../common/types/auth.types.js';
import { InternalRbacRepository } from '../internal-rbac.repository.js';

@Injectable()
export class InternalPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacRepository: InternalRbacRepository,
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
      throw new ForbiddenException('El usuario interno no tiene los permisos requeridos para esta operación.');
    }

    return true;
  }
}
