import { describe, expect, it } from '@jest/globals';
import { INTERNAL_PERMISSIONS_KEY } from '../../../src/modules/internal-users/internal-permissions.decorator.js';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from '../../../src/modules/internal-users/internal-rbac.permissions.js';
import { CreditOperationsController } from '../../../src/modules/credit/credit-operations.controller.js';
import { LoanPaymentsController } from '../../../src/modules/loans/loan-payments.controller.js';
import { LoansController } from '../../../src/modules/loans/loans.controller.js';

/**
 * Las rutas de dinero no se abren con el rol grueso del token: todo usuario interno sin rol
 * especializado (soporte, cobranza, operaciones de comercios) recibe `internal_operator`, y con él
 * bastaba para aprobar, desembolsar y registrar un cobro en efectivo. Cada ruta exige su permiso.
 */
const exigido = (clase: { prototype: object }, metodo: string): string[] | undefined => {
  const handler = (clase.prototype as Record<string, unknown>)[metodo];
  return Reflect.getMetadata(INTERNAL_PERMISSIONS_KEY, handler as object) as string[] | undefined;
};

describe('permisos finos de las operaciones de dinero', () => {
  it.each([
    [CreditOperationsController, 'decideApplication', 'credit.application.decide'],
    [CreditOperationsController, 'createProduct', 'credit.product.manage'],
    [CreditOperationsController, 'changeProductStatus', 'credit.product.manage'],
    [LoansController, 'disburse', 'credit.loan.disburse'],
    [LoanPaymentsController, 'registerPayment', 'loans.payment.register'],
    [LoanPaymentsController, 'reversePayment', 'loans.payment.reverse'],
  ] as const)('%p.%s exige %s', (clase, metodo, permiso) => {
    expect(exigido(clase, metodo)).toEqual([permiso]);
  });

  it('los cinco permisos están en el catálogo y SUPER_ADMIN los tiene', () => {
    const codigos = [
      'credit.application.decide',
      'credit.product.manage',
      'credit.loan.disburse',
      'loans.payment.register',
      'loans.payment.reverse',
    ];
    const catalogo = new Set(INTERNAL_PERMISSION_SEEDS.map((p) => p.code));
    for (const c of codigos) {
      expect(catalogo.has(c)).toBe(true);
      expect(ROLE_PERMISSION_CODES.SUPER_ADMIN).toContain(c);
    }
  });

  it('PRUEBA EN NEGATIVO — soporte y agentes de cobranza no mueven dinero', () => {
    for (const rol of ['SUPPORT_AGENT', 'COLLECTIONS_AGENT', 'MERCHANT_OPERATIONS', 'DATA_QUALITY_ANALYST'] as const) {
      expect(ROLE_PERMISSION_CODES[rol]).not.toContain('loans.payment.register');
      expect(ROLE_PERMISSION_CODES[rol]).not.toContain('credit.loan.disburse');
      expect(ROLE_PERMISSION_CODES[rol]).not.toContain('credit.application.decide');
    }
  });
});
