/**
 * @file Contrato tipado: forma de un proceso de negocio declarado en código.
 * @business Esta pieza hace que cada proceso de Atlas —quién lo inicia, quién lo cierra, qué pasa cuando falla— exista en el código y no sólo en la siembra demo.
 * @system define la fixture que `syncWorkflowCatalog` vuelca a las tablas `workflow_*` y que los gates `check:process-*` validan.
 */

/** Bloques que pueden servir un paso. Es el `code` de Flow Intelligence (`flow-model/<BLOQUE>`). */
export const PROCESS_SYSTEM_CODES = [
  'ATLAS_BACKEND',
  'DECISION_ENGINE',
  'ERP_BACKEND',
  'DASHBOARDS',
  'AI_SERVICE',
  'EXTERNAL_PROVIDERS_MOCK',
] as const;
export type ProcessSystemCode = (typeof PROCESS_SYSTEM_CODES)[number];

/** Cliente desde el que una persona ejecuta una etapa, o `BLOCK` cuando la ejecuta un sistema. */
export const PROCESS_CLIENT_CODES = ['ADMIN_PORTAL', 'ERP_PORTAL', 'MOTOR_PORTAL', 'CONSUMER_APP', 'DASHBOARDS_PORTAL', 'BLOCK'] as const;
export type ProcessClientCode = (typeof PROCESS_CLIENT_CODES)[number];

/**
 * Naturaleza del paso. Sólo `http` apunta a una ruta; los demás existen porque un proceso real no es
 * sólo llamadas: hay eventos del outbox, jobs programados, acciones fuera del sistema (firmar un
 * contrato en papel) y llamadas a terceros.
 */
export const PROCESS_STEP_KINDS = ['http', 'event', 'job', 'manual', 'external'] as const;
export type ProcessStepKind = (typeof PROCESS_STEP_KINDS)[number];

export const PROCESS_PRIORITIES = ['P0', 'P1', 'P2'] as const;
export type ProcessPriority = (typeof PROCESS_PRIORITIES)[number];

export const PROCESS_ACTOR_TYPES = ['customer', 'internal_user', 'merchant_user', 'platform_user', 'system', 'external_provider'] as const;
export type ProcessActorType = (typeof PROCESS_ACTOR_TYPES)[number];

/**
 * Las cinco preguntas que un proceso tiene que contestar para contar como documentado. Cada una con
 * 80 caracteres o más (`check:process-narratives`): menos no alcanza para contestarla.
 */
export type ProcessNarrative = {
  /** Por qué existe: qué problema de negocio resuelve. */
  whyExists: string;
  /** Quién lo inicia y quién lo cierra (personas o sistemas, con su rol). */
  whoStartsAndCloses: string;
  /** Cuándo empieza y cuándo termina (el disparador y el estado final). */
  startAndEnd: string;
  /** Qué pasa cuando falla, y quién se entera. */
  whenItFails: string;
  /** Qué indicador dice que va bien. */
  healthIndicator: string;
};

/** Dónde vive una instancia del proceso, para poder listar las que están en curso. */
export type ProcessInstanceEntity = {
  system: ProcessSystemCode;
  schema: string;
  table: string;
  idColumn: string;
  statusColumn: string;
  /** Columna legible para la lista (nombre, código). */
  labelColumn?: string;
  /** Instancias que se consideran abiertas; el resto, cerradas. */
  openStatuses?: string[];
};

export type ProcessStepFixture = {
  code: string;
  name: string;
  description: string;
  /** `http` si se omite. */
  kind?: ProcessStepKind;
  /** Bloque que sirve el paso; `ATLAS_BACKEND` si se omite. */
  system?: ProcessSystemCode;
  /** Obligatorios cuando `kind` es `http`. */
  method?: string;
  path?: string;
  /** Para `kind: 'job'`: código del job en `scheduled-jobs.catalog.ts` o del bloque que lo corre. */
  job?: string;
  /** Para `event`, `manual` y `external`: por qué no es una llamada HTTP. */
  reason?: string;
  roles?: string[];
  auth?: boolean;
  optional?: boolean;
  repeatable?: boolean;
  idempotencyKey?: boolean;
  requiredStates?: string[];
  resultingStates?: string[];
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errors?: string[];
  /** Eventos que produce (código del `event-registry`). */
  events?: string[];
  /** Eventos que consume. */
  consumes?: string[];
  successStatus?: number[];
};

export type ProcessStageFixture = {
  code: string;
  name: string;
  description: string;
  module: string;
  actor: ProcessActorType;
  /** Cliente desde el que actúa la persona; `BLOCK` cuando actúa un sistema. */
  client: ProcessClientCode;
  /** Ruta de la pantalla donde actúa la persona (obligatoria si el actor es una persona). */
  screen?: string;
  /** Enlace con contexto a otro portal: `{MOTOR}/manual-reviews/{instanceId}`. */
  link?: string;
  /** Código de la etapa madre, para subetapas. */
  parent?: string;
  optional?: boolean;
  entry?: boolean;
  terminal?: boolean;
  roles?: string[];
  requiredStates?: string[];
  resultingStates?: string[];
  completionRule?: Record<string, unknown>;
  steps: ProcessStepFixture[];
};

/** Transición explícita entre dos pasos (bifurcaciones reales: éxito, error, estado). */
export type ProcessTransitionFixture = {
  code: string;
  from: string | null;
  to: string | null;
  condition: string;
  expression?: Record<string, unknown>;
  description?: string;
  order?: number;
  isDefault?: boolean;
};

/** Dependencia explícita. Si la fixture no declara ninguna, cada paso depende del anterior. */
export type ProcessDependencyFixture = {
  step: string;
  dependsOn: string;
  type: string;
  description?: string;
};

export type WorkflowDefinitionFixture = {
  /** Identificador del inventario del plan (`P-01`…). */
  processId: string;
  code: string;
  version: string;
  name: string;
  description: string;
  processType: string;
  ownerDomain: string;
  /** Rol interno dueño (código de `INTERNAL_ROLE_CODES`, o `ERP:<rol>` / `MOTOR:<rol>`). */
  ownerRole: string;
  priority: ProcessPriority;
  systems: ProcessSystemCode[];
  narrative: ProcessNarrative;
  instanceEntity?: ProcessInstanceEntity;
  success: string;
  failure: string;
  /** Fuentes de las que sale la narrativa: ficheros, memorias, planes. */
  sources: string[];
  metadata?: Record<string, unknown>;
  stages: ProcessStageFixture[];
  transitions?: ProcessTransitionFixture[];
  dependencies?: ProcessDependencyFixture[];
};
