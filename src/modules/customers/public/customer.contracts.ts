/**
 * @file Contrato público de Clientes: lo que otros contextos pueden saber de un cliente (AT-024).
 * @business Un consumidor ve el estado operativo y el veredicto de elegibilidad como valores; no ve
 *   la fila del cliente, ni puede cambiarla, ni recibe sus datos personales.
 * @system Sólo valores serializables. La escritura del ciclo de vida no cruza esta frontera: la hace el
 *   dueño (`CustomerLifecycleService`) con revisión válida y el bloqueo de fila de AT-007.
 */
export type CustomerLifecycleCode =
  'registered' | 'onboarding_in_progress' | 'under_review' | 'observed' | 'active' | 'suspended' | 'rejected' | 'blocked' | 'closed';

export type CustomerStateView = Readonly<{
  tenantId: string;
  customerId: string;
  lifecycleStatus: CustomerLifecycleCode;
  /** Caché del último veredicto de elegibilidad, tal como lo guarda el dueño. */
  creditEligibilityStatus: string | null;
  eligibilityEvaluatedAt: string | null;
  /** Momento de la lectura: el consumidor sabe cuán fresca es. */
  readAt: string;
}>;

export type EligibilitySummary = Readonly<{
  eligible: boolean;
  /** Códigos de bloqueo, en el orden de la regla. Sin campos ni detalles con PII. */
  blockers: readonly string[];
  ruleVersion: string;
  lifecycleStatus: CustomerLifecycleCode;
  evaluatedAt: string;
}>;

export const CUSTOMER_STATE_ERRORS = ['CUSTOMER_NOT_FOUND'] as const;
export type CustomerStateErrorCode = (typeof CUSTOMER_STATE_ERRORS)[number];
