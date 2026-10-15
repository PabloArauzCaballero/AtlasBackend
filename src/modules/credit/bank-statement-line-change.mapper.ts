/**
 * @file La forma con la que sale a la API lo que el extracto le hizo a la línea.
 * @business La respuesta a «subí mi extracto, ¿y qué cambió?»: la línea de antes, la de ahora y la cuenta que las une.
 * @system compone, desde la línea que abrió el extracto y la que cerró, el bloque `lineChange` de la revisión.
 */
import type { CreditLineModel } from '../../database/models/index.js';

/**
 * El ejercicio de recalcular la línea, paso por paso, como lo hace el sistema.
 *
 * 1. **Lo que el extracto soporta**: la cuota mensual que el motor midió × los meses del plazo.
 * 2. **Los topes**: el de la relación con la plataforma (tramo × Bs 1.500), el de subida escalonada (el doble de
 *    lo que se propuso la vez anterior) y el techo del producto.
 * 3. **Manda el menor** de todos —la propuesta de Atlas—, redondeado de 50 en 50 hacia abajo.
 * 4. **El Motor aplica su política** sobre esa propuesta (el porcentaje de la banda de riesgo) y emite la línea.
 *
 * Antes la pantalla del extracto enseñaba sólo la cuota del paso 1. Quien leía «sostienes Bs 1.500 al mes» esperaba
 * una línea de Bs 4.500 y veía Bs 1.500 sin saber qué la había frenado. Con los cuatro pasos a la vista, la cifra
 * final deja de ser un veredicto y se puede comprobar.
 */
export type LineCalculation = {
  monthlyInstallment: number | null;
  termMonths: number | null;
  byCapacity: number | null;
  byRelationship: number | null;
  relationshipTier: string | null;
  byGraduation: number | null;
  productCeiling: number | null;
  recommendedLimit: number | null;
  bindingConstraint: string | null;
  riskBand: string | null;
  approvedLimit: number;
};

export type LineChange = {
  /** La línea antes de este extracto; `null` si es la primera que se calculó. */
  previousLimit: number | null;
  newLimit: number;
  currencyCode: string;
  calculation: LineCalculation | null;
};

/** Lo mínimo de la evaluación que se guardó junto a la línea (`capacityJson`). */
interface StoredCapacity {
  monthlyInstallment?: number;
  recommendedLimit?: number;
  bindingConstraint?: string;
  relationshipTier?: string;
  ceilings?: { byCapacity?: number | null; byRelationship?: number; byGraduation?: number | null; product?: number };
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * El plazo no se guarda: se deduce de las dos cifras que sí, porque `byCapacity` es exactamente cuota × plazo.
 * Leerlo de la política de HOY afirmaría que el cálculo de ayer usó el plazo de hoy.
 */
function termOf(byCapacity: number | null, installment: number | null): number | null {
  if (byCapacity === null || installment === null || installment <= 0) return null;
  return Math.round(byCapacity / installment);
}

export function calculationOf(line: CreditLineModel): LineCalculation | null {
  const capacity = line.capacityJson as StoredCapacity | null;
  const approvedLimit = finite(line.approvedLimit) ?? 0;
  if (!capacity) return null;
  const monthlyInstallment = finite(capacity.monthlyInstallment);
  const byCapacity = finite(capacity.ceilings?.byCapacity);
  return {
    monthlyInstallment,
    termMonths: termOf(byCapacity, monthlyInstallment),
    byCapacity,
    byRelationship: finite(capacity.ceilings?.byRelationship),
    relationshipTier: capacity.relationshipTier ?? line.relationshipTier,
    byGraduation: finite(capacity.ceilings?.byGraduation),
    productCeiling: finite(capacity.ceilings?.product),
    recommendedLimit: finite(capacity.recommendedLimit ?? line.recommendedLimit),
    bindingConstraint: capacity.bindingConstraint ?? line.capacityBinding,
    riskBand: line.riskBand,
    approvedLimit,
  };
}

/** `applied` es la línea que abrió el extracto; `previous`, la que esa línea sustituyó. */
export function toLineChange(applied: CreditLineModel | null, previous: CreditLineModel | null): LineChange | null {
  if (!applied) return null;
  return {
    previousLimit: previous ? finite(previous.approvedLimit) : null,
    newLimit: finite(applied.approvedLimit) ?? 0,
    currencyCode: applied.currencyCode,
    calculation: calculationOf(applied),
  };
}
