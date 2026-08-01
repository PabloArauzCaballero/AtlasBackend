/**
 * @file Regla pura: si un cliente ya elegible además califica para UN producto concreto.
 * @business Separa "puede pedir crédito" de "puede pedir ESTE crédito": un cliente habilitado puede
 * no alcanzar el ingreso mínimo de un producto y sí el de otro.
 * @system evalúa los requisitos declarados en `credit_products` contra los atributos económicos
 * vigentes del cliente, sin tocar base de datos.
 */

export type ProductRequirements = {
  productCode: string;
  currencyCode: string;
  minAmount: string;
  maxAmount: string;
  minTermMonths: number;
  maxTermMonths: number;
  /** Ingreso mensual declarado mínimo. Estaba en el modelo desde el inicio y no se evaluaba. */
  minMonthlyIncome: string | null;
};

export type ProductRequestedTerms = {
  requestedAmount: number;
  requestedTermMonths: number;
};

export type ProductBlocker = {
  code: 'REQUESTED_AMOUNT_OUT_OF_RANGE' | 'REQUESTED_TERM_OUT_OF_RANGE' | 'INSUFFICIENT_DECLARED_INCOME' | 'DECLARED_INCOME_MISSING';
  detail: string;
};

/** Código del atributo económico que sostiene el requisito de ingreso. */
export const MONTHLY_INCOME_ATTRIBUTE = 'monthly_income_declared';

/**
 * Requisitos del producto frente a lo que el cliente pidió y declara ganar.
 *
 * Devuelve la lista completa —no corta en el primer problema— por la misma razón que la regla de
 * habilitación: el frontend necesita poder decirle al cliente todo lo que le falta para ese producto
 * de una sola vez, en vez de una cosa por intento.
 *
 * El ingreso se compara contra lo DECLARADO. Verificarlo contra un extracto o el buró es una etapa
 * posterior del proceso crediticio; aquí solo se filtra lo que ni siquiera en el papel alcanza.
 */
export function evaluateProductEligibility(
  product: ProductRequirements,
  requested: ProductRequestedTerms,
  financialAttributeValues: Readonly<Record<string, number>>,
): ProductBlocker[] {
  const blockers: ProductBlocker[] = [];

  const minAmount = Number(product.minAmount);
  const maxAmount = Number(product.maxAmount);
  if (requested.requestedAmount < minAmount || requested.requestedAmount > maxAmount) {
    blockers.push({ code: 'REQUESTED_AMOUNT_OUT_OF_RANGE', detail: `${product.minAmount}-${product.maxAmount}` });
  }

  if (requested.requestedTermMonths < product.minTermMonths || requested.requestedTermMonths > product.maxTermMonths) {
    blockers.push({ code: 'REQUESTED_TERM_OUT_OF_RANGE', detail: `${product.minTermMonths}-${product.maxTermMonths}` });
  }

  // Un producto sin umbral de ingreso no lo exige: la ausencia de requisito no es un requisito de cero.
  if (product.minMonthlyIncome !== null) {
    const required = Number(product.minMonthlyIncome);
    const declared = financialAttributeValues[MONTHLY_INCOME_ATTRIBUTE];

    if (declared === undefined || !Number.isFinite(declared)) {
      // No debería ocurrir con un cliente ya elegible (C5 exige el atributo), pero un producto no
      // puede aprobarse "por defecto" si el dato falta: sin ingreso declarado no hay con qué comparar.
      blockers.push({ code: 'DECLARED_INCOME_MISSING', detail: MONTHLY_INCOME_ATTRIBUTE });
    } else if (Number.isFinite(required) && declared < required) {
      blockers.push({ code: 'INSUFFICIENT_DECLARED_INCOME', detail: `required=${product.minMonthlyIncome}` });
    }
  }

  return blockers;
}

/** `true` si el cliente califica para el producto con los términos pedidos. */
export function meetsProductRequirements(
  product: ProductRequirements,
  requested: ProductRequestedTerms,
  financialAttributeValues: Readonly<Record<string, number>>,
): boolean {
  return evaluateProductEligibility(product, requested, financialAttributeValues).length === 0;
}

/**
 * Requisitos que el cliente cumple con independencia del monto pedido.
 *
 * Se usa al listar el catálogo, donde todavía no hay términos: interesa saber si el producto es
 * ofrecible, no si un monto concreto encaja. Se evalúa con el monto mínimo y el plazo mínimo, que es
 * la petición más favorable posible para el cliente.
 */
export function qualifiesForProduct(product: ProductRequirements, financialAttributeValues: Readonly<Record<string, number>>): boolean {
  return meetsProductRequirements(
    product,
    { requestedAmount: Number(product.minAmount), requestedTermMonths: product.minTermMonths },
    financialAttributeValues,
  );
}
