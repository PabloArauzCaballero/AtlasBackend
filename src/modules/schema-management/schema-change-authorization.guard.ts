/**
 * @file Guard: aplica autenticación o autorización antes del caso de uso.
 * @business Proponer y aprobar un cambio de esquema tiene que poder hacerlo una persona interna con el permiso fino, sin cerrar la puerta a la sesión de plataforma.
 * @system en sesión interna delega en `InternalPermissionsGuard` (`@InternalPermissions`); en sesión de plataforma deja pasar y el servicio exige el rol de sesión.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { RequestWithAuth } from '../../common/types/auth.types.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';

/**
 * `InternalPermissionsGuard` solo, en la clase, respondería 403 a toda sesión que no sea interna
 * («Esta operación requiere una sesión interna»), y el change log también lo firman usuarios de
 * plataforma (`platform_admin`). Este guard reparte por población:
 *
 * - sesión interna (`internalUserId`): decide el permiso fino declarado en la ruta
 *   (`governance.schema.propose` / `governance.schema.approve`). Sin permisos declarados —las
 *   lecturas—, pasa.
 * - cualquier otra sesión: pasa; `resolveSchemaChangeActor` exige su rol de sesión en el servicio.
 */
@Injectable()
export class SchemaChangeAuthorizationGuard implements CanActivate {
  constructor(private readonly internalPermissions: InternalPermissionsGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<RequestWithAuth>().user;
    if (user?.internalUserId) return this.internalPermissions.canActivate(context);
    return true;
  }
}
