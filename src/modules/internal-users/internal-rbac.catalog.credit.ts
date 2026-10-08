/**
 * @file Permisos internos sobre el CICLO de crédito y el libro de préstamos.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system enumera los permisos internos de este grupo.
 */
import { permission, type InternalPermissionSeed } from './internal-rbac.permission-builder.js';

/**
 * Frente 3A (plan `_plan-motor-decisiones-tasa-2026-09-25`): el desembolso deja de aceptar
 * `annualInterestRate` libre del operador. Sólo con este permiso —y un motivo escrito— se puede
 * anular la tasa decidida (por el Motor o por el producto), y aun así el valor sigue clampeado al
 * rango del producto y al tope de usura: el permiso autoriza a PEDIR una excepción, no a saltarse el
 * tope legal.
 */
export const CREDIT_PERMISSION_SEEDS: readonly InternalPermissionSeed[] = [
  permission({
    code: 'credit.loan_disbursement.override_rate',
    module: 'credit',
    resource: 'loan_disbursement',
    action: 'override_rate',
    description:
      'Fijar al desembolsar una tasa distinta de la que decidió el Motor o la del producto. Sigue clampeada al rango del producto y al tope de usura.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  /*
   * Las operaciones de dinero ya no se abren con el rol grueso del token. Todo usuario interno sin
   * rol especializado —soporte, cobranza, operaciones de comercios— recibe `internal_operator`, y
   * con ese rol bastaba para aprobar una solicitud, desembolsarla y registrarle un cobro en
   * efectivo sin evidencia. Cada ruta exige ahora su permiso, y el permiso lo concede el rol.
   */
  permission({
    code: 'credit.application.decide',
    module: 'credit',
    resource: 'application',
    action: 'decide',
    description: 'Aprobar, rechazar o pedir información sobre una solicitud de crédito en revisión manual.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'credit.product.manage',
    module: 'credit',
    resource: 'product',
    action: 'manage',
    description: 'Crear productos crediticios y cambiar su estado (activar, suspender, retirar).',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'credit.loan.disburse',
    module: 'credit',
    resource: 'loan',
    action: 'disburse',
    description: 'Desembolsar una solicitud aprobada: crea el préstamo y su cronograma y consume el cupo.',
    riskLevel: 'CRITICAL',
  }),
  permission({
    code: 'loans.payment.register',
    module: 'loans',
    resource: 'payment',
    action: 'register',
    description: 'Registrar un cobro sobre un préstamo: baja la deuda del cliente.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'loans.payment.reverse',
    module: 'loans',
    resource: 'payment',
    action: 'reverse',
    description: 'Reversar un cobro ya aplicado (cheque devuelto, error de imputación): la deuda vuelve.',
    riskLevel: 'CRITICAL',
    requiresReason: true,
  }),
];
