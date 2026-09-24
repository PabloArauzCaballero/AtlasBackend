/**
 * @file Contratos del dominio: estados, veredictos y bloqueos de una corrida QA.
 * @business Esta pieza fija qué significa que N personas sintéticas "recorrieron el flujo" y qué
 *   no cuenta como prueba aprobada.
 * @system tipos puros compartidos por preflight, ejecutor, worker, API y portal.
 *
 * Tres distinciones que el resto del módulo existe para no mezclar:
 *
 * - **Terminado ≠ aprobado.** Una corrida `COMPLETED` terminó el trabajo planificado; si una
 *   persona falló, su `verdict` es `FAILED`. Un timeout nunca es completitud satisfactoria.
 * - **Omitido ≠ aprobado.** `SKIPPED_DEPENDENCY` y `NOT_APPLICABLE` no entran en el numerador ni en
 *   el denominador de la tasa de aprobación, y se publican aparte.
 * - **Sin muestras ≠ 100 %.** Un denominador cero devuelve `null`, no un porcentaje.
 */

export const QA_RUN_STATUSES = [
  'QUEUED',
  'PREFLIGHT',
  'RUNNING',
  'CANCELLING',
  'COMPLETED',
  'CANCELLED',
  'BLOCKED',
  'FAILED_INFRASTRUCTURE',
  'TIMED_OUT',
] as const;
export type QaRunStatus = (typeof QA_RUN_STATUSES)[number];

/** Estados en los que la corrida ya no admite más trabajo. */
export const QA_RUN_TERMINAL_STATUSES: readonly QaRunStatus[] = ['COMPLETED', 'CANCELLED', 'BLOCKED', 'FAILED_INFRASTRUCTURE', 'TIMED_OUT'];

export type QaRunVerdict = 'PASSED' | 'FAILED' | 'INCONCLUSIVE';

export const QA_PERSONA_STATUSES = ['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'BLOCKED', 'INDETERMINATE', 'CANCELLED'] as const;
export type QaPersonaStatus = (typeof QA_PERSONA_STATUSES)[number];

export const QA_STEP_STATUSES = [
  'PENDING',
  'RUNNING',
  'PASSED',
  'FAILED',
  'SKIPPED_DEPENDENCY',
  'NOT_APPLICABLE',
  'INDETERMINATE',
  'CANCELLED',
] as const;
export type QaStepStatus = (typeof QA_STEP_STATUSES)[number];

export type QaRunMode = 'INTEGRATED_QA' | 'MOCK_DIAGNOSTIC';
export type QaDatasetMode = 'NORMAL_SYNTHETIC' | 'INVALID' | 'BOUNDARY' | 'OUTCOMES' | 'MIXED';

/** Identidad del entorno de negocio. La configura el despliegue, nunca una cabecera del usuario. */
export type DeploymentEnvironment = 'LOCAL' | 'TEST' | 'STAGING' | 'PROD';

/** Códigos accionables del preflight. Cada uno tiene un mensaje humano en `blockerMessage`. */
export const QA_BLOCKER_CODES = [
  'ENDPOINT_UNRESOLVED',
  'CONTRACT_MISMATCH',
  'ACTOR_UNAVAILABLE',
  'FIXTURE_MISSING',
  'WORKER_UNAVAILABLE',
  'MOCK_UNAVAILABLE',
  'PLATFORM_SERVICE_UNAVAILABLE',
  'SCENARIO_UNSUPPORTED',
  'UNSAFE_ENVIRONMENT',
  'BUDGET_EXCEEDED',
  'BINDING_UNRESOLVED',
  'GRAPH_INVALID',
  'TEMPLATE_NOT_READY',
  'INVALID_INPUT',
] as const;
export type QaBlockerCode = (typeof QA_BLOCKER_CODES)[number];

export type QaBlocker = {
  code: QaBlockerCode;
  message: string;
  /** Paso, proveedor o campo que lo provoca, si aplica. */
  subject?: string;
};

export type QaRunLimits = {
  maxRequests: number;
  maxDurationMs: number;
  maxInFlightRequests: number;
};

/** Lo que el operador pide. El servidor lo recorta contra la política del entorno y lo anuncia. */
export type QaRunRequest = {
  templateCode: string;
  templateVersion: string;
  /** Flujo del árbol desde el que se lanza; por defecto, el de la plantilla. */
  workflowCode?: string;
  environmentId: string;
  mode: QaRunMode;
  persons: number;
  concurrency: number;
  seed: string;
  datasetMode: QaDatasetMode;
  scenarioCode: string;
  limits?: Partial<QaRunLimits>;
};

/** Capacidad publicada por el entorno. Por encima se rechaza, sin clamp silencioso. */
export type QaEnvironmentPolicy = {
  environmentId: string;
  label: string;
  deploymentEnvironment: DeploymentEnvironment;
  maxPersons: number;
  maxConcurrency: number;
  limits: QaRunLimits;
};

/** Contadores de corrida. La definición de cada uno está en `run-accounting.ts`. */
export type QaRunCounters = {
  personsRequested: number;
  personsPending: number;
  personsRunning: number;
  personsPassed: number;
  personsFailed: number;
  personsBlocked: number;
  personsIndeterminate: number;
  personsCancelled: number;
  stepsPassed: number;
  stepsFailed: number;
  stepsIndeterminate: number;
  stepsSkipped: number;
  stepsNotApplicable: number;
  requestsIssued: number;
  /** PASSED / (PASSED + FAILED) de pasos. `null` = sin muestras. */
  passRate: number | null;
};
