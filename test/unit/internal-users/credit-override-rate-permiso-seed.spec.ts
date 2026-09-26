import { describe, expect, it } from '@jest/globals';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from '../../../src/modules/internal-users/internal-rbac.permissions.js';

/**
 * El permiso que un operador necesita para anular la tasa decidida por el Motor o por el producto
 * (Frente 3A, plan `_plan-motor-decisiones-tasa-2026-09-25`, §1.1 punto 5).
 *
 * ## Qué defecto evita
 *
 * Mismo mecanismo que ya reparó `expedientes-permisos-seed.spec.ts`: el catálogo se siembra por
 * migración, y si este permiso desapareciera de la lista canónica —o de la migración que lo vuelve
 * a volcar (`20260926091500-sync-internal-rbac-catalog-3`)—, `loan-disbursement.service.ts` seguiría
 * comprobándolo, pero NINGÚN usuario interno lo tendría en la base: el desembolso respondería 403
 * incluso a quien debería poder pedir la excepción, en TODOS los entornos.
 */
const PERMISO = 'credit.loan_disbursement.override_rate';

describe('permiso de anular la tasa del desembolso en el catálogo RBAC', () => {
  it('está en la lista canónica que siembra la migración', () => {
    const codigos = new Set(INTERNAL_PERMISSION_SEEDS.map((p) => p.code));
    expect(codigos.has(PERMISO)).toBe(true);
  });

  it('exige motivo por catálogo, no por convención del servicio', () => {
    const seed = INTERNAL_PERMISSION_SEEDS.find((p) => p.code === PERMISO);
    expect(seed?.requiresReason).toBe(true);
  });

  it('es de riesgo ALTO: anular un precio decidido no es una operación de bajo impacto', () => {
    const seed = INTERNAL_PERMISSION_SEEDS.find((p) => p.code === PERMISO);
    expect(seed?.riskLevel).toBe('HIGH');
  });

  it('SUPER_ADMIN lo tiene: si a éste le faltara, no lo tendría nadie', () => {
    const suyos = new Set(ROLE_PERMISSION_CODES.SUPER_ADMIN ?? []);
    expect(suyos.has(PERMISO)).toBe(true);
  });

  it('PRUEBA EN NEGATIVO — un rol operativo sin este permiso en su lista no puede anular la tasa', () => {
    // OPERATIONS_ANALYST no gestiona desembolsos con excepción; si apareciera aquí sin que alguien
    // lo hubiera decidido, cualquier analista podría saltarse el control que este Frente instaló.
    const suyos = new Set(ROLE_PERMISSION_CODES.OPERATIONS_ANALYST ?? []);
    expect(suyos.has(PERMISO)).toBe(false);
  });
});
