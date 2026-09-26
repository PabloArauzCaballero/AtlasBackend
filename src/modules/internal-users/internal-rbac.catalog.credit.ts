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
];
