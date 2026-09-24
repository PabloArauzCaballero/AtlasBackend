/**
 * @file Contratos del dominio: la receta ejecutable de un journey QA.
 * @business Esta pieza convierte un flujo documentado en un recorrido que una persona sintética
 *   puede ejecutar sin que nadie busque IDs ni redacte JSON.
 * @system tipos declarativos: bindings tipados, condiciones y un catálogo CERRADO de aserciones.
 *
 * La receta es DATOS, no código. Nada de `eval` ni de funciones recibidas por JSON: una condición
 * o una aserción es un objeto de un catálogo finito que el evaluador conoce. Eso es lo que permite
 * versionar, hashear y congelar la receta en el snapshot de una corrida.
 *
 * Referencias (`JourneyPath`) empiezan por una raíz conocida:
 *
 * - `persona.*`   identidad sintética determinista (email, pin, monthlyIncome…).
 * - `resources.*` lo que la persona obtuvo de respuestas anteriores (customerId, applicationId…).
 * - `fixtures.*`  catálogos resueltos en el setup (consents, productId…), inmutables en la corrida.
 * - `run.*`       runId, namespace, seed, referenceDate.
 * - `response.*`  el cuerpo de ESTA respuesta; sólo en aserciones y extractores.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JourneyPath = string;

/**
 * Un binding es un valor JSON donde:
 * - `{ "$ref": "persona.monthlyIncome" }` se sustituye por el valor CON SU TIPO (número, array…);
 * - una cadena con `{{persona.email}}` se interpola como texto, y sólo dentro de cadenas.
 * Una referencia inexistente es `BINDING_UNRESOLVED` antes del envío, nunca un `"undefined"`.
 */
export type Binding = JsonValue | { $ref: JourneyPath } | Binding[] | { [key: string]: Binding };

export type Condition =
  | { kind: 'equals'; path: JourneyPath; value: JsonValue }
  | { kind: 'exists'; path: JourneyPath }
  | { kind: 'truthy'; path: JourneyPath }
  | { kind: 'not'; condition: Condition }
  | { kind: 'all'; conditions: Condition[] }
  | { kind: 'any'; conditions: Condition[] };

export type ValueType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/** Catálogo cerrado y versionado. Añadir un tipo aquí es un cambio de contrato. */
export type Assertion =
  | { kind: 'exists'; path: JourneyPath }
  | { kind: 'type'; path: JourneyPath; type: ValueType }
  | { kind: 'equals'; path: JourneyPath; expected: Binding }
  | { kind: 'oneOf'; path: JourneyPath; values: JsonValue[] }
  | { kind: 'contains'; path: JourneyPath; value: JsonValue }
  | { kind: 'arrayNonEmpty'; path: JourneyPath }
  | { kind: 'arrayLength'; path: JourneyPath; equals?: number; min?: number }
  /** Como `equals`, pero su fallo se reporta como sesión o recurso de OTRA persona. */
  | { kind: 'resourceOwner'; path: JourneyPath; expected: Binding }
  | { kind: 'arrayContainsWhere'; path: JourneyPath; field: string; expected: Binding }
  | { kind: 'errorCode'; code: string }
  /** Consistencia entre dos lecturas: el valor de la respuesta igual a uno ya extraído. */
  | { kind: 'sameAs'; path: JourneyPath; ref: JourneyPath };

export const ASSERTION_KINDS = [
  'exists',
  'type',
  'equals',
  'oneOf',
  'contains',
  'arrayNonEmpty',
  'arrayLength',
  'resourceOwner',
  'arrayContainsWhere',
  'errorCode',
  'sameAs',
] as const;

export type ActorRef = 'anonymous' | 'customer' | 'internal_user' | 'merchant_user';

/** Qué se espera del transporte y del negocio. `branches` elige según el estado ANTES del envío. */
export type Expectation = {
  status: number[];
  assertions?: Assertion[];
};

export type ExpectationBranch = Expectation & { when: Condition; label: string };

export type Extraction = {
  /** Destino: `resources.x` o `session.<actor>.accessToken|refreshToken`. */
  to: string;
  /** Ruta dentro de la respuesta: `response.data.customerId`. */
  from: JourneyPath;
  /** Si falta y es obligatorio, el paso FALLA: un dependiente no puede arrancar sin él. */
  required?: boolean;
};

/**
 * Qué llamada al proveedor debe (o no) producir el paso, contrastada contra el journal del mock.
 * `none` es tan importante como `required`: un preview de costo que llama al proveedor es un fallo.
 */
export type ProviderExpectation = {
  provider: string;
  expectCall: 'required' | 'none' | 'cache_or_call';
};

export type RecipeStep = {
  stepKey: string;
  /** `stepCode` del catálogo de flujos al que da cobertura. */
  workflowStepCode?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Plantilla de ruta relativa a la base de la API: `/customers/{{resources.customerId}}/me`. */
  path: string;
  actor: ActorRef;
  /** Por defecto depende del paso anterior de la lista. `[]` = independiente. */
  dependsOn?: string[];
  /** Condición de aplicabilidad evaluada con estado VERIFICADO; falsa ⇒ NOT_APPLICABLE con motivo. */
  applicability?: { when: Condition; reason: string };
  body?: Binding;
  query?: Record<string, Binding>;
  /** `per_operation`: clave estable por (run, persona, paso, visita). Nunca incluye el intento. */
  idempotency?: 'per_operation';
  expect: Expectation;
  branches?: ExpectationBranch[];
  extract?: Extraction[];
  rateLimit?: { bucket: string; perMinute: number };
  /** Reintentos de TRANSPORTE. Sólo en lecturas o en escrituras con idempotencia declarada. */
  retry?: { maxAttempts: number };
  timeoutMs?: number;
  /** Espera de un proceso asíncrono: repite la lectura hasta cumplir `until` o vencer el plazo. */
  poll?: { intervalMs: number; deadlineMs: number; until: Assertion[] };
  providers?: ProviderExpectation[];
  /**
   * Repetible al retomar tras un reinicio para recuperar la sesión (el login). Los tokens no se
   * persisten, así que la persona vuelve a entrar con sus credenciales deterministas.
   */
  replayOnResume?: boolean;
};

export type TemplateStatus = 'READY' | 'BLOCKED' | 'DRAFT';

export type JourneyTemplate = {
  code: string;
  version: string;
  name: string;
  description: string;
  workflowCode: string;
  workflowVersion: string;
  actors: ActorRef[];
  /** Escenarios del mock que la receta sabe interpretar. Pedir otro bloquea el preflight. */
  scenarios: string[];
  defaultScenario: string;
  datasetModes: Array<'NORMAL_SYNTHETIC' | 'INVALID' | 'BOUNDARY' | 'OUTCOMES' | 'MIXED'>;
  expectedTerminal: string;
  status: TemplateStatus;
  /** Motivos por los que no está READY. Una plantilla BLOCKED se enseña, no se ejecuta. */
  blockedReasons?: string[];
  /** Fixtures que el setup debe resolver antes de la primera persona. */
  fixtures: Array<'consents' | 'creditProduct' | 'internalActor' | 'merchantActor'>;
  steps: RecipeStep[];
};
