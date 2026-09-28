import { describe, expect, it } from '@jest/globals';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from '../../../src/modules/internal-users/internal-rbac.permissions.js';

/**
 * Los permisos de la cola de solicitudes del titular (hallazgo A5).
 *
 * Mismo defecto que ya reparó `expedientes-permisos-seed.spec.ts`: el catálogo se siembra por
 * migración (`20260927120000-sync-internal-rbac-catalog-5`), y si estos códigos salieran de la lista
 * canónica el controlador los seguiría exigiendo y NADIE los tendría: 403 para todos.
 */
const LEER = 'privacy.requests.read';
const GESTIONAR = 'privacy.requests.manage';

describe('permisos de solicitudes del titular en el catálogo RBAC', () => {
  it('están en la lista canónica que siembra la migración', () => {
    const codigos = new Set(INTERNAL_PERMISSION_SEEDS.map((p) => p.code));
    expect(codigos.has(LEER)).toBe(true);
    expect(codigos.has(GESTIONAR)).toBe(true);
  });

  it('gestionar es de riesgo alto y exige motivo por catálogo', () => {
    const seed = INTERNAL_PERMISSION_SEEDS.find((p) => p.code === GESTIONAR);
    expect(seed).toMatchObject({ riskLevel: 'HIGH', requiresReason: true });
  });

  it('la jefatura de cumplimiento lee y gestiona; el analista sólo lee', () => {
    expect(ROLE_PERMISSION_CODES.COMPLIANCE_MANAGER).toEqual(expect.arrayContaining([LEER, GESTIONAR]));
    expect(ROLE_PERMISSION_CODES.COMPLIANCE_ANALYST).toContain(LEER);
    expect(ROLE_PERMISSION_CODES.COMPLIANCE_ANALYST).not.toContain(GESTIONAR);
  });

  it('SUPER_ADMIN tiene los dos y el auditor sólo el de lectura', () => {
    expect(ROLE_PERMISSION_CODES.SUPER_ADMIN).toEqual(expect.arrayContaining([LEER, GESTIONAR]));
    expect(ROLE_PERMISSION_CODES.AUDITOR_READONLY).toContain(LEER);
    expect(ROLE_PERMISSION_CODES.AUDITOR_READONLY).not.toContain(GESTIONAR);
  });

  it('PRUEBA EN NEGATIVO — operaciones no cierra solicitudes del titular', () => {
    expect(ROLE_PERMISSION_CODES.OPERATIONS_MANAGER).not.toContain(GESTIONAR);
    expect(ROLE_PERMISSION_CODES.SUPPORT_AGENT).not.toContain(LEER);
  });
});
