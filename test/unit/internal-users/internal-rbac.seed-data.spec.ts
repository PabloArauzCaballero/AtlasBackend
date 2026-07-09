import { describe, expect, it } from '@jest/globals';
import {
  INTERNAL_PERMISSION_SEEDS,
  INTERNAL_ROLE_CODES,
  INTERNAL_ROLE_SEEDS,
  ROLE_PERMISSION_CODES,
  legacyRoleForInternalRoles,
} from '../../../src/modules/internal-users/internal-rbac.seed-data.js';

function uniqueCount(values: readonly string[]): number {
  return new Set(values).size;
}

describe('internal RBAC seed data', () => {
  it('defines every required ATLAS internal role exactly once', () => {
    const codesFromSeeds = INTERNAL_ROLE_SEEDS.map((role) => role.code);
    expect(codesFromSeeds).toHaveLength(INTERNAL_ROLE_CODES.length);
    expect(uniqueCount(codesFromSeeds)).toBe(codesFromSeeds.length);
    expect(codesFromSeeds.sort()).toEqual([...INTERNAL_ROLE_CODES].sort());
  });

  it('does not assign permissions that are missing from the permission catalog', () => {
    const permissionCodes = new Set(INTERNAL_PERMISSION_SEEDS.map((permission) => permission.code));
    const assignedPermissions = Object.values(ROLE_PERMISSION_CODES).flat();
    const missing = assignedPermissions.filter((permissionCode) => !permissionCodes.has(permissionCode));
    expect(missing).toEqual([]);
  });

  it('keeps SUPER_ADMIN as the only role with all permissions by construction', () => {
    expect(ROLE_PERMISSION_CODES.SUPER_ADMIN.length).toBe(INTERNAL_PERMISSION_SEEDS.length);
    expect(uniqueCount(ROLE_PERMISSION_CODES.SUPER_ADMIN)).toBe(INTERNAL_PERMISSION_SEEDS.length);
  });

  it('includes frontend contract permissions from internal platform skill', () => {
    const permissionCodes = new Set(INTERNAL_PERMISSION_SEEDS.map((permission) => permission.code));
    expect(permissionCodes.has('internal.users.read')).toBe(true);
    expect(permissionCodes.has('internal.users.manage')).toBe(true);
    expect(permissionCodes.has('internal.roles.read')).toBe(true);
    expect(permissionCodes.has('internal.permissions.read')).toBe(true);
    expect(permissionCodes.has('systems.endpoints.catalogSeedRefresh')).toBe(true);
  });

  it('maps new RBAC roles to legacy roles used by existing @Roles guards', () => {
    expect(legacyRoleForInternalRoles(['SUPER_ADMIN'])).toBe('admin');
    expect(legacyRoleForInternalRoles(['RISK_ANALYST'])).toBe('risk_analyst');
    expect(legacyRoleForInternalRoles(['FRAUD_ANALYST'])).toBe('fraud_analyst');
    expect(legacyRoleForInternalRoles(['COMPLIANCE_ANALYST'])).toBe('compliance_analyst');
    expect(legacyRoleForInternalRoles(['AUDITOR_READONLY'])).toBe('readonly_auditor');
    expect(legacyRoleForInternalRoles(['SUPPORT_AGENT'])).toBe('internal_operator');
  });
});
