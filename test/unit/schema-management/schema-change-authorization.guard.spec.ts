import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InternalPermissionsGuard } from '../../../src/modules/internal-users/guards/internal-permissions.guard.js';
import { SchemaChangeAuthorizationGuard } from '../../../src/modules/schema-management/schema-change-authorization.guard.js';
import { SchemaManagementController } from '../../../src/modules/schema-management/schema-management.controller.js';
import { ROLE_PERMISSION_CODES } from '../../../src/modules/internal-users/internal-rbac.permissions.js';

/**
 * Hallazgo A4 (P-35): proponer y aprobar un cambio de esquema desde el portal interno.
 *
 * Se prueba con el `Reflector` REAL sobre los métodos REALES del controlador, así que si alguien
 * quita o cambia el `@InternalPermissions` de una ruta, esto falla: el RBAC falso sólo concede el
 * código exacto que la ruta pide.
 */
describe('SchemaChangeAuthorizationGuard', () => {
  function build(granted: readonly string[]) {
    const rbac = {
      hasPermissions: jest.fn(async (_tenant: string, _user: string, required: string[]) => required.every((p) => granted.includes(p))),
    };
    const guard = new SchemaChangeAuthorizationGuard(new InternalPermissionsGuard(new Reflector(), rbac as never));
    return { guard, rbac };
  }

  const ctx = (handler: keyof SchemaManagementController, user: unknown) =>
    ({
      getHandler: () => SchemaManagementController.prototype[handler],
      getClass: () => SchemaManagementController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;

  const internal = (id: string) => ({ sub: `i-${id}`, role: 'admin', tenantId: '1', internalUserId: id });

  it('usuario interno con governance.schema.propose puede proponer', async () => {
    const { guard } = build(['governance.schema.propose']);
    await expect(guard.canActivate(ctx('proposeTable', internal('7')))).resolves.toBe(true);
  });

  it('otro usuario interno con governance.schema.approve puede aprobar', async () => {
    const { guard } = build(['governance.schema.approve']);
    await expect(guard.canActivate(ctx('approveChange', internal('8')))).resolves.toBe(true);
  });

  it('403 sin el permiso, nombrando el permiso que falta', async () => {
    const { guard } = build(['governance.data.read']);
    await expect(guard.canActivate(ctx('proposeTable', internal('7')))).rejects.toThrow(/governance\.schema\.propose/);
    await expect(guard.canActivate(ctx('approveChange', internal('7')))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('proponer no concede aprobar: son dos permisos', async () => {
    const { guard } = build(['governance.schema.propose']);
    await expect(guard.canActivate(ctx('approveChange', internal('7')))).rejects.toThrow(/governance\.schema\.approve/);
  });

  it('las lecturas no piden permiso fino', async () => {
    const { guard, rbac } = build([]);
    await expect(guard.canActivate(ctx('listChangeLog', internal('7')))).resolves.toBe(true);
    expect(rbac.hasPermissions).not.toHaveBeenCalled();
  });

  it('sesión de plataforma: el guard no decide (el servicio exige el rol de sesión)', async () => {
    const { guard, rbac } = build([]);
    const platformAdmin = { sub: 'p-20', role: 'platform_admin', platformUserId: '20' };
    await expect(guard.canActivate(ctx('approveChange', platformAdmin))).resolves.toBe(true);
    expect(rbac.hasPermissions).not.toHaveBeenCalled();
  });

  it('el rol que gobierna datos recibe los dos permisos, y un analista de operaciones ninguno', () => {
    for (const role of ['DATA_GOVERNANCE_MANAGER', 'SYSTEMS_ADMIN', 'SUPER_ADMIN'] as const) {
      expect(ROLE_PERMISSION_CODES[role]).toEqual(expect.arrayContaining(['governance.schema.propose', 'governance.schema.approve']));
    }
    expect(ROLE_PERMISSION_CODES.OPERATIONS_ANALYST).not.toContain('governance.schema.propose');
    expect(ROLE_PERMISSION_CODES.AUDITOR_READONLY).not.toContain('governance.schema.approve');
  });
});
