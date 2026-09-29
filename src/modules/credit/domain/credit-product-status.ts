/**
 * @file Regla de dominio: a qué estado puede pasar un producto crediticio desde cada estado.
 * @business Un producto retirado no vuelve a ofrecerse, y uno en borrador no se «suspende»: el ciclo es explícito.
 * @system tabla de transiciones permitidas; el servicio la consulta antes de escribir y de auditar.
 */

export const CREDIT_PRODUCT_STATUSES = ['draft', 'active', 'suspended', 'retired'] as const;
export type CreditProductStatus = (typeof CREDIT_PRODUCT_STATUSES)[number];

/**
 * Las transiciones permitidas. Antes el cambio de estado escribía cualquier valor sobre cualquier
 * otro —de `retired` a `active` incluido—, así que retirar un producto no significaba nada.
 *
 * - `draft` se activa o se retira sin haberse ofrecido nunca.
 * - `active` se suspende (pausa temporal) o se retira.
 * - `suspended` se reactiva o se retira.
 * - `retired` es terminal: volver a ofrecer ese producto es crear otro, con su propio código.
 */
export const CREDIT_PRODUCT_TRANSITIONS: Readonly<Record<CreditProductStatus, readonly CreditProductStatus[]>> = {
  draft: ['active', 'retired'],
  active: ['suspended', 'retired'],
  suspended: ['active', 'retired'],
  retired: [],
};

export function isCreditProductStatus(value: string | null | undefined): value is CreditProductStatus {
  return (CREDIT_PRODUCT_STATUSES as readonly string[]).includes(value ?? '');
}

/** ¿Se puede pasar de `from` a `to`? Un estado desconocido en la base no transita a nada. */
export function canTransitionCreditProduct(from: string | null | undefined, to: CreditProductStatus): boolean {
  return isCreditProductStatus(from) && CREDIT_PRODUCT_TRANSITIONS[from].includes(to);
}
