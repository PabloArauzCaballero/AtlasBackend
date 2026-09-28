import { describe, expect, it } from '@jest/globals';
import { ROLES_KEY } from '../../../src/common/decorators/roles.decorator.js';
import { AppContentOperationsController } from '../../../src/modules/app-content/app-content-operations.controller.js';
import { INTERNAL_ROLE_SEEDS } from '../../../src/modules/internal-users/internal-rbac.roles.js';
import { ROLE_PERMISSION_CODES } from '../../../src/modules/internal-users/internal-rbac.permissions.js';
import { NotificationPoliciesOperationsController } from '../../../src/modules/notifications/notification-policies-operations.controller.js';
import { NotificationTemplatesController } from '../../../src/modules/notifications/notification-templates.controller.js';
import { NotificationsController } from '../../../src/modules/notifications/notifications.controller.js';

/**
 * El portal decide qué pantalla y qué botón enseña por PERMISO del catálogo RBAC interno; estos
 * controladores deciden por ROL heredado (`legacy_role_code`). Si las dos listas no cuentan lo mismo
 * pasan dos cosas, las dos medidas en TEST el 2026-09-28:
 *
 * - quien tiene el permiso de lectura ve la entrada del menú y recibe 403 (cumplimiento y auditoría
 *   en «Políticas de notificación» y «Contenido de la app»; auditoría en «Mensajería interna»);
 * - quien NO tiene el permiso de gestión puede cambiar lo que se le dice al cliente con una llamada
 *   directa (un agente de soporte declarando opcional el aviso de mora).
 *
 * La prueba deriva los roles esperados del catálogo, no de una lista copiada: si mañana un rol gana
 * o pierde el permiso, esto falla y obliga a mirar el controlador.
 */
function legacyRolesHolding(permission: string): string[] {
  const holders = INTERNAL_ROLE_SEEDS.filter((role) =>
    (ROLE_PERMISSION_CODES[role.code as keyof typeof ROLE_PERMISSION_CODES] ?? []).includes(permission),
  );
  return [...new Set(holders.map((role) => role.legacyRoleCode))];
}

function legacyRolesLacking(permission: string): string[] {
  const holding = new Set(legacyRolesHolding(permission));
  return [...new Set(INTERNAL_ROLE_SEEDS.map((role) => role.legacyRoleCode))].filter((role) => !holding.has(role));
}

function rolesOf(handler: object): string[] {
  return (Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined) ?? [];
}

describe('Roles de lo que se le dice al cliente, alineados con el catálogo RBAC', () => {
  const readers = legacyRolesHolding('governance.policies.read');
  const managers = legacyRolesHolding('governance.policies.manage');

  it.each([
    ['GET políticas de notificación', NotificationPoliciesOperationsController.prototype.list],
    ['GET contenido de la app', AppContentOperationsController.prototype.list],
  ])('%s deja entrar a todo rol con governance.policies.read', (_name, handler) => {
    expect(readers).toEqual(expect.arrayContaining(['compliance_analyst', 'readonly_auditor']));
    expect(rolesOf(handler)).toEqual(expect.arrayContaining(readers));
  });

  it.each([
    ['PUT políticas de notificación', NotificationPoliciesOperationsController.prototype.upsert],
    ['PUT contenido de la app', AppContentOperationsController.prototype.upsert],
    ['DELETE contenido de la app', AppContentOperationsController.prototype.remove],
  ])('%s sólo deja escribir a roles con governance.policies.manage', (_name, handler) => {
    const roles = rolesOf(handler);
    expect(roles).toEqual(expect.arrayContaining(managers));
    for (const lacking of legacyRolesLacking('governance.policies.manage')) expect(roles).not.toContain(lacking);
  });

  it.each([
    ['GET mensajes', NotificationsController.prototype.listMessages],
    ['GET un mensaje', NotificationsController.prototype.getMessage],
    ['GET plantillas', NotificationTemplatesController.prototype.listTemplates],
  ])('%s deja entrar a todo rol con notifications.messages.read o notifications.templates.read', (_name, handler) => {
    const readersOfMessages = [...legacyRolesHolding('notifications.messages.read'), ...legacyRolesHolding('notifications.templates.read')];
    expect(rolesOf(handler)).toEqual(expect.arrayContaining(readersOfMessages));
  });
});
