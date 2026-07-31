/**
 * Máquina de estados del ciclo de vida del cliente.
 *
 * ANTES de este módulo, `customers.lifecycle_status` era un `STRING(40)` nullable sin CHECK y sin
 * tipo en TypeScript: convivían once valores escritos o leídos por módulos que no se conocían entre
 * sí (`registered`, `pending_identity_review`, `active`, `blocked`, `closed`, `approved`,
 * `pending_review`, `approved_for_next_step`, `pending_more_information`, `pending_fraud_review`,
 * `NULL`). Cuatro de ellos los LEÍA medio backend y no los ESCRIBÍA nadie, de modo que ninguna regla
 * construida sobre ese campo podía ser correcta.
 *
 * Este archivo es la única fuente de verdad de:
 *   1. qué estados existen,
 *   2. qué transiciones son legales,
 *   3. qué estado permite qué operación.
 *
 * El único componente autorizado a escribir el campo es `CustomerLifecycleService`, que valida cada
 * transición contra `ALLOWED_TRANSITIONS` y escribe el evento de historial en la MISMA transacción.
 */

export const CUSTOMER_LIFECYCLE_STATUSES = [
  /** Cuenta creada. Nada verificado todavía. */
  'registered',
  /** Al menos un contacto verificado; el cliente está completando datos y documentos. */
  'onboarding_in_progress',
  /** Paquete obligatorio enviado; validaciones automáticas y/o revisión humana en curso. */
  'under_review',
  /** Falta información concreta o hay que corregirla. El cliente puede actuar. */
  'observed',
  /** Cliente aprobado y operativo. Único estado que puede habilitar crédito. */
  'active',
  /** Habilitación suspendida temporalmente (alerta, re-KYC vencido, cambio sensible). */
  'suspended',
  /** Rechazado por riesgo o cumplimiento. */
  'rejected',
  /** Bloqueado por fraude o cumplimiento. */
  'blocked',
  /** Cerrado a pedido del titular o por política de retención. Terminal. */
  'closed',
] as const;

export type CustomerLifecycleStatus = (typeof CUSTOMER_LIFECYCLE_STATUSES)[number];

export const INITIAL_CUSTOMER_LIFECYCLE_STATUS: CustomerLifecycleStatus = 'registered';

/**
 * Transiciones legales. Todo lo que no esté aquí se rechaza con `INVALID_STATUS_TRANSITION`.
 *
 * Notas de diseño:
 *  - `closed` es terminal: no tiene salidas. Un cliente que pidió la baja no vuelve por un UPDATE.
 *  - `blocked` y `rejected` solo salen hacia `under_review` (reapertura/apelación) o `closed`. No
 *    existe `blocked -> active` directo: levantar un bloqueo obliga a volver a evaluar.
 *  - `active -> active` está permitido para que una reevaluación de elegibilidad que sigue siendo
 *    favorable sea idempotente y no falle.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<CustomerLifecycleStatus, readonly CustomerLifecycleStatus[]>> = {
  registered: ['onboarding_in_progress', 'observed', 'blocked', 'closed'],
  onboarding_in_progress: ['under_review', 'observed', 'blocked', 'closed'],
  under_review: ['active', 'observed', 'rejected', 'blocked', 'closed'],
  observed: ['onboarding_in_progress', 'under_review', 'rejected', 'blocked', 'closed'],
  active: ['active', 'observed', 'suspended', 'blocked', 'closed'],
  suspended: ['active', 'observed', 'under_review', 'blocked', 'closed'],
  rejected: ['under_review', 'closed'],
  blocked: ['under_review', 'closed'],
  closed: [],
};

/** Estados desde los que el cliente todavía puede editar su información de onboarding. */
export const EDITABLE_ONBOARDING_STATUSES: readonly CustomerLifecycleStatus[] = ['registered', 'onboarding_in_progress', 'observed'];

/** Estados que impiden cualquier operación de negocio (no solo la edición). */
export const OPERATION_BLOCKING_STATUSES: readonly CustomerLifecycleStatus[] = ['blocked', 'rejected', 'closed'];

/** Único estado que puede derivar en habilitación crediticia. Ver `CustomerEligibilityService`. */
export const CREDIT_ELIGIBLE_STATUS: CustomerLifecycleStatus = 'active';

export function isCustomerLifecycleStatus(value: string | null | undefined): value is CustomerLifecycleStatus {
  return value !== null && value !== undefined && (CUSTOMER_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: CustomerLifecycleStatus, to: CustomerLifecycleStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Normaliza un valor persistido antes de la migración de estados.
 *
 * La migración `20260728090000` hace el backfill en base de datos, pero un despliegue mixto (código
 * nuevo contra una réplica todavía sin migrar) podría leer un valor viejo. En vez de romper, se
 * traduce al equivalente canónico; cualquier valor desconocido cae al estado inicial, que es el más
 * restrictivo posible (obliga a rehacer el recorrido, nunca habilita de más).
 */
const LEGACY_STATUS_MAP: Readonly<Record<string, CustomerLifecycleStatus>> = {
  pending_identity_review: 'under_review',
  pending_review: 'under_review',
  pending_fraud_review: 'under_review',
  pending_more_information: 'observed',
  approved: 'active',
  approved_for_next_step: 'active',
};

export function normalizeLifecycleStatus(value: string | null | undefined): CustomerLifecycleStatus {
  if (isCustomerLifecycleStatus(value)) return value;
  if (value && LEGACY_STATUS_MAP[value]) return LEGACY_STATUS_MAP[value];
  return INITIAL_CUSTOMER_LIFECYCLE_STATUS;
}
