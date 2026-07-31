/**
 * Vocabulario cerrado del catálogo de flujos de trabajo.
 *
 * Los mismos valores están impuestos por CHECK constraints en la migración
 * `20260728140000-create-workflow-catalog`. Duplicarlos aquí no es redundancia: la base garantiza
 * que nadie escriba un valor inválido, y estas constantes permiten que TypeScript lo impida ANTES
 * del viaje a la base y que los schemas Zod publiquen el conjunto legal en el OpenAPI. Si un valor
 * cambia, hay que cambiar los dos lados en la misma migración.
 */

/** Estado de activación de una versión del flujo. */
export const WORKFLOW_STATUSES = ['draft', 'active', 'deprecated'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/** Origen del registro: sembrado, editado a mano o inferido por descubrimiento. */
export const WORKFLOW_SOURCES = ['seed', 'manual', 'discovery'] as const;
export type WorkflowSource = (typeof WORKFLOW_SOURCES)[number];

/** Familia del proceso. Permite filtrar el catálogo sin abrir cada definición. */
export const WORKFLOW_PROCESS_TYPES = ['customer_journey', 'back_office', 'system_job', 'integration'] as const;
export type WorkflowProcessType = (typeof WORKFLOW_PROCESS_TYPES)[number];

/** Quién ejecuta la etapa. Es lo que decide si una etapa aparece en la app o en el portal interno. */
export const WORKFLOW_ACTOR_TYPES = ['customer', 'internal_user', 'system', 'external_provider'] as const;
export type WorkflowActorType = (typeof WORKFLOW_ACTOR_TYPES)[number];

/** Naturaleza de la dependencia entre dos pasos. */
export const WORKFLOW_DEPENDENCY_TYPES = ['requires_completion', 'requires_data', 'soft'] as const;
export type WorkflowDependencyType = (typeof WORKFLOW_DEPENDENCY_TYPES)[number];

/**
 * Condición bajo la que una transición es transitable.
 *
 * `on_state` es la que hace que el grafo sea verificable contra el dominio: su expresión nombra
 * estados reales de `customer_lifecycle.constants.ts`, de modo que el informe de consistencia puede
 * detectar que alguien escribió un estado que la máquina de estados no conoce.
 */
export const WORKFLOW_CONDITION_TYPES = ['always', 'on_success', 'on_error', 'on_state', 'conditional'] as const;
export type WorkflowConditionType = (typeof WORKFLOW_CONDITION_TYPES)[number];

export const WORKFLOW_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type WorkflowHttpMethod = (typeof WORKFLOW_HTTP_METHODS)[number];

/**
 * Regla que decide si una etapa está cumplida para un cliente concreto.
 *
 * El catálogo NO reimplementa el cálculo de avance: delega en la evaluación de habilitación, que ya
 * es la única fuente de "dónde va el cliente" (ver `customer-eligibility.evaluator.ts`). Cada tipo
 * de regla es una forma distinta de leer ESA evaluación:
 *
 *  - `onboarding_section`: la etapa está completa si la sección homónima lo está.
 *  - `lifecycle_status`:   completa si el estado del cliente ya alcanzó alguno de los indicados.
 *  - `no_blockers`:        completa si ninguno de los bloqueadores listados sigue activo.
 *  - `manual`:             no se puede derivar automáticamente (p. ej. la decisión de un analista).
 */
export const WORKFLOW_COMPLETION_RULE_TYPES = ['onboarding_section', 'lifecycle_status', 'no_blockers', 'manual'] as const;
export type WorkflowCompletionRuleType = (typeof WORKFLOW_COMPLETION_RULE_TYPES)[number];

/** Código del flujo estándar sembrado por `20260728140000-seed-standard-customer-credit-workflow`. */
export const STANDARD_CUSTOMER_CREDIT_WORKFLOW_CODE = 'customer_credit_journey';

/** Roles que pueden leer el catálogo de flujos: cualquiera que construya una experiencia sobre él. */
export const WORKFLOW_CATALOG_READ_ROLES = [
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
  'admin',
  'platform_admin',
] as const;

/** Roles que pueden pedir el informe de consistencia (expone rutas internas no publicadas). */
export const WORKFLOW_CATALOG_GOVERNANCE_ROLES = ['system_admin', 'qa_engineer', 'devops', 'admin', 'platform_admin'] as const;

/** Roles que pueden consultar el avance de UN cliente dentro del flujo. */
export const WORKFLOW_PROGRESS_ROLES = [
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'admin',
  'platform_admin',
] as const;

/** Estado de un paso o etapa para un cliente concreto, calculado en tiempo real. */
export const WORKFLOW_PROGRESS_STATUSES = ['completed', 'current', 'pending', 'blocked', 'not_applicable'] as const;
export type WorkflowProgressStatus = (typeof WORKFLOW_PROGRESS_STATUSES)[number];
