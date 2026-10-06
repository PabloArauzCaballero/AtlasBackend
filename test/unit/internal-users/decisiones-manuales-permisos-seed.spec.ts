import { describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from '../../../src/modules/internal-users/internal-rbac.permissions.js';
import { INTERNAL_PERMISSIONS_KEY } from '../../../src/modules/internal-users/internal-permissions.decorator.js';
import { PartnerOperationsController } from '../../../src/modules/partner-onboarding/partner-operations.controller.js';
import { CustomerEligibilityController } from '../../../src/modules/customers/customer-eligibility.controller.js';

/**
 * Las dos decisiones manuales que habilitan —al comercio a cobrar, al cliente a pedir crédito— sólo
 * pedían el rol de aplicación `internal_operator`, que comparten soporte y cobranza. Ahora piden un
 * permiso interno; esta prueba fija que la ruta lo declara y que el catálogo lo concede sólo a quien
 * decide (si faltara en el catálogo, la ruta respondería 403 a todos, ni SUPER_ADMIN).
 */
const reflector = new Reflector();
const requeridos = (clase: { prototype: object }, metodo: string): string[] | undefined =>
  reflector.get<string[]>(INTERNAL_PERMISSIONS_KEY, (clase.prototype as Record<string, () => unknown>)[metodo]);

describe('permisos de las decisiones manuales', () => {
  it('POST :partnerId/decision exige partner.kyb.decide', () => {
    expect(requeridos(PartnerOperationsController, 'decide')).toEqual(['partner.kyb.decide']);
  });

  it('decideEligibility exige customers.eligibility.decide', () => {
    expect(requeridos(CustomerEligibilityController, 'decideEligibility')).toEqual(['customers.eligibility.decide']);
  });

  it.each(['partner.kyb.decide', 'customers.eligibility.decide'])('%s está en el catálogo con riesgo ALTO y lo tiene SUPER_ADMIN', (codigo) => {
    expect(INTERNAL_PERMISSION_SEEDS.find((p) => p.code === codigo)?.riskLevel).toBe('HIGH');
    expect(ROLE_PERMISSION_CODES.SUPER_ADMIN).toContain(codigo);
  });

  it.each(['partner.kyb.decide', 'customers.eligibility.decide'])('PRUEBA EN NEGATIVO: soporte, cobranza y quien pide (%s) no lo tienen', (codigo) => {
    for (const rol of ['SUPPORT_AGENT', 'COLLECTIONS_AGENT', 'COLLECTIONS_MANAGER', 'OPERATIONS_MANAGER', 'OPERATIONS_ANALYST'] as const) {
      expect(ROLE_PERMISSION_CODES[rol] ?? []).not.toContain(codigo);
    }
  });
});
