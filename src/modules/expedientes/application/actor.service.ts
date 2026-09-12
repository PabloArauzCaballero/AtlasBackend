/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Identifica a quien opera sobre un expediente, con sus roles y permisos reales.
 * @system traduce la sesión autenticada al actor que entienden el guard y la bitácora.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InternalRbacRepository } from '../../internal-users/internal-rbac.repository.js';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import type { ActorExpediente } from '../expedientes.types.js';

/**
 * Quién es el actor, en los términos que necesita la autorización del expediente.
 *
 * ## Por qué no basta con `request.user`
 *
 * El token trae un rol HEREDADO —`internal_operator`, `risk_analyst`…—, que es un resumen de los
 * roles internos reales calculado por `legacyRoleForInternalRoles`. Sirve para `@Roles(...)`, que
 * es una lista corta, y no sirve aquí: una concesión puede darse a `FRAUD_ANALYST`, y ese código no
 * viaja en el token. Hay que ir a la base por el perfil de acceso.
 *
 * ## Por qué se cachea por petición
 *
 * Una pantalla de archivos hace varias comprobaciones sobre la misma petición —listar la carpeta y
 * resolver el nivel de cada hijo—, y cada una necesita los mismos roles. Sin caché serían tantas
 * consultas como filas. El mapa vive en la petición y muere con ella: los permisos no se quedan
 * pegados entre peticiones, que es justo lo que haría peligrosa una caché de autorización.
 */
@Injectable()
export class ActorService {
  constructor(private readonly rbac: InternalRbacRepository) {}

  async resolver(user: AuthenticatedUser | undefined, cache?: Map<string, ActorExpediente>): Promise<ActorExpediente> {
    if (!user?.tenantId || !user.internalUserId) {
      // El cliente entra a sus propios documentos por `customer-onboarding`, no por aquí. Decirlo
      // como 403 y no como 401 es correcto: la sesión es válida, el actor no es de este módulo.
      throw new ForbiddenException('EXPEDIENTE_REQUIERE_SESION_INTERNA');
    }

    const clave = `${user.tenantId}:${user.internalUserId}`;
    const enCache = cache?.get(clave);
    if (enCache) return enCache;

    const filas = await this.rbac.getRolePermissionRows(user.tenantId, user.internalUserId);
    const actor: ActorExpediente = {
      tipo: 'internal_user',
      id: user.internalUserId,
      roles: [...new Set(filas.map((fila) => fila.roleCode).filter((valor): valor is string => Boolean(valor)))],
      permisos: [...new Set(filas.map((fila) => fila.permissionCode).filter((valor): valor is string => Boolean(valor)))],
    };
    cache?.set(clave, actor);
    return actor;
  }

  /** El actor con el que el propio sistema escribe: ganchos del onboarding, jobs, backfill. */
  sistema(): ActorExpediente {
    return { tipo: 'system', id: null, roles: [], permisos: ['expedientes.administrar'] };
  }
}
