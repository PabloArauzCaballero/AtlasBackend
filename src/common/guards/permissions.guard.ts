import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest();
    const userPermissions: string[] = request.user?.permissions ?? [];
    const hasAll = required.every((permission) => userPermissions.includes(permission));
    if (!hasAll) {
      throw new ForbiddenException({
        code: 'RBAC_PERMISSION_DENIED',
        message: 'No tiene el permiso requerido.',
      });
    }
    return true;
  }
}
