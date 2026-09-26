/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system fija el contrato con el motor externo y lo valida en el borde, sin confiar en su forma.
 */
import { z } from 'zod';

/**
 * Contrato de respuesta del motor, validado en el borde.
 *
 * Se valida aunque el motor sea «de casa». Un cambio de forma al otro lado —un campo que pasa a
 * `null`, un `score` que empieza a llegar como texto— produciría aquí un `undefined` que viaja
 * silencioso hasta convertirse en una aprobación mal escrita en el libro de préstamos. Es más barato
 * fallar en el borde con un mensaje que explique qué llegó.
 *
 * `passthrough` a propósito: el motor añade campos con el tiempo y esto no debe romperse por eso.
 * Lo que se declara es lo que el core LEE, ni más ni menos.
 */
const decisionReasonObjectSchema = z
  .object({
    code: z.string(),
    category: z.string().nullish(),
    message: z.string().nullish(),
    adverseAction: z.boolean().nullish(),
    priority: z.number().nullish(),
  })
  .passthrough();

/**
 * Un motivo llega como objeto o como código suelto, y las dos formas son válidas.
 *
 * El motor manda `[{code, message, adverseAction}]` cuando la política publicó el motivo con su
 * texto, y `["BUREAU_SCORE_TOO_LOW"]` cuando solo hay el código. Aceptar únicamente la primera
 * convertía una respuesta perfectamente buena en «motor no disponible» —que es lo que pasó al
 * recalcular una línea aprobada, donde los motivos vienen sin texto— y una aprobación se perdía por
 * la forma de un campo secundario.
 *
 * Se normaliza a objeto en el borde para que nadie aguas abajo tenga que preguntarse cuál llegó.
 */
export const decisionReasonSchema = z.union([
  decisionReasonObjectSchema,
  z.string().transform((code) => ({ code }) as z.infer<typeof decisionReasonObjectSchema>),
]);

export const decisionResponseSchema = z
  .object({
    executionId: z.string().min(1),
    status: z.string().min(1),
    outcome: z.string().nullish(),
    score: z.number().nullish(),
    riskBand: z.string().nullish(),
    limit: z.number().nullish(),
    output: z.record(z.string(), z.unknown()).nullish(),
    reasonCodes: z.array(decisionReasonSchema).default([]),
    artifact: z
      .object({
        code: z.string().nullish(),
        versionId: z.string().nullish(),
        deploymentId: z.string().nullish(),
        environment: z.string().nullish(),
        checksum: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    /*
     * El caso de revisión manual que el motor ABRIÓ, si abrió alguno.
     *
     * Lo que decide si Atlas se aparta o no. Sin este campo había que adivinarlo por el desenlace, y
     * la adivinanza se equivoca en la dirección peor: un `REJECT` no abre caso en el motor, así que
     * apartarse ante cualquier desenlace que no fuera «sigue adelante» dejaba al analista mirando
     * una ejecución sin bandeja mientras la única cola posible —la de Atlas— se había cerrado.
     *
     * `nullish` y no obligatorio porque un motor anterior a este contrato no lo manda: en ese caso
     * no se delega, que es el comportamiento de siempre y el que no pierde casos.
     */
    manualReview: z
      .object({
        caseCode: z.string().nullish(),
        queueCode: z.string().nullish(),
        priority: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
    /*
     * Campos aditivos del contrato del motor (P-09/P-10/P-11, motor `70cddc2`). Todos `nullish`: un
     * motor anterior no los manda y eso no puede convertir una respuesta buena en «motor no
     * disponible». Lo que NO se tolera es que lleguen con otra forma: eso sí es un contrato roto.
     *
     * - `decisionValidUntil`: hasta cuándo vale la decisión (sólo en SUCCEEDED). Core no concede
     *   después de `min(decisionValidUntil, decidedAt + CREDIT_DECISION_VALIDITY_HOURS)`.
     * - `exposure`: el límite más estrecho del motor y cuánto queda antes y después de lo pedido.
     * - `degradedInputs` / `freshnessUnknown`: alguna entrada llegó dudosa / qué variables CRÍTICAS
     *   no tienen frescura comprobable. Con cualquiera de las dos, Core no concede solo.
     * - `enablingBasis`: de dónde salió la política de base habilitante y, si falta, por qué.
     */
    decisionValidUntil: z.string().datetime({ offset: true }).nullish(),
    exposure: z
      .object({
        limitCode: z.string().nullish(),
        currencyCode: z.string().nullish(),
        maxValue: z.number().nullish(),
        enforced: z.boolean().nullish(),
        currentExposure: z.number().nullish(),
        requestedAmount: z.number().nullish(),
        remainingBeforeDecision: z.number().nullish(),
        remainingAfterDecision: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
    degradedInputs: z.boolean().nullish(),
    freshnessUnknown: z.array(z.string()).nullish(),
    enablingBasis: z
      .object({
        policySource: z.string().nullish(),
        purposes: z.array(z.string()).nullish(),
        failures: z.array(z.object({ purpose: z.string(), reason: z.string() }).passthrough()).nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type DecisionResponse = z.infer<typeof decisionResponseSchema>;

export type DecisionRequest = {
  requestId: string;
  correlationId?: string;
  idempotencyKey: string;
  subjectReference?: string;
  environmentCode?: string;
  variables: Record<string, unknown>;
  /** De cuándo es cada valor (P-10). Sin fecha conocida la variable NO aparece: nunca se inventa. */
  variableMetadata?: VariableMetadata;
  context?: Record<string, unknown>;
};

/**
 * `observedAt`: cuándo era cierto el valor. `fetchedAt`: cuándo lo obtuvo Core, y el motor sólo lo
 * usa si falta el primero. Por eso `fetchedAt` sólo se manda para lo que Core LEE en vivo de su propio
 * libro al decidir; un dato declarado hace meses lleva su `observedAt` o nada.
 */
export type VariableMetadata = Record<string, { observedAt?: string; fetchedAt?: string; sourceVersion?: string }>;

/**
 * Desenlace de la llamada, ya interpretado por el core.
 *
 * `engineUnavailable` se distingue de `declined` a propósito. Las dos son «no se aprueba», pero
 * significan cosas opuestas: una es la política diciendo que no, la otra es no haber preguntado. Si
 * se colapsan, un motor caído se registra en el libro como una cartera de rechazos que la política
 * nunca emitió, y el monitoreo lo leería como un endurecimiento repentino del modelo.
 */
export type DecisionOutcome =
  | { kind: 'approved'; response: DecisionResponse }
  | { kind: 'declined'; response: DecisionResponse }
  | { kind: 'review'; response: DecisionResponse; technical?: boolean; reason?: string }
  | { kind: 'engineUnavailable'; reason: string }
  /**
   * No se preguntó al motor A PROPÓSITO y se puede volver a intentar: la base habilitante todavía no
   * llegó (P-09). Ni rechazo ni aprobación; la solicitud queda sin decidir para el reintento.
   */
  | { kind: 'deferred'; reason: string };

export type OutcomeObservationInput = {
  executionId: string;
  windowDays: number;
  label: string;
  amount?: number;
  source: string;
  notes?: string;
};

/**
 * Un crédito concedido, tal como lo espera `POST /v1/outcomes/facilities`.
 *
 * `originationExecutionId` no es opcional y ésa es la restricción que manda: el motor toma de esa
 * decisión el SUJETO, y la referencia del solicitante viaja en HMAC de una vía, así que no se puede
 * añadir después. Un préstamo desembolsado sin decisión del motor —una carga manual, un crédito
 * anterior a la integración— no se puede registrar, y el motor lo rechaza diciéndolo.
 */
export type FacilityRegistrationInput = {
  externalReference: string;
  originationExecutionId: string;
  principalAmount: number;
  currencyCode: string;
  termMonths: number;
  /** Tasa ANUAL en tanto por uno. `0,28`, no `28`. */
  annualRate: number;
  disbursedAt?: string;
};

/** El veredicto del motor para UN crédito del lote. */
export type FacilityRegistrationOutcome = {
  externalReference: string;
  accepted: boolean;
  /**
   * Código estable del rechazo (`FACILITY_REFERENCE_CONFLICT`, `EXECUTION_NOT_DECIDED`,
   * `FACILITY_REGISTRATION_FAILED`, `EXECUTION_NOT_FOUND`…) o `null` si se aceptó.
   */
  reason: string | null;
  /** Ya estaba registrado igual: reenvío idempotente, cuenta como éxito. */
  duplicate: boolean;
};

/**
 * Un desenlace identificado por el CRÉDITO, que es el camino que cierra la ventana de observación.
 */
export type FacilityOutcomeInput = {
  externalReference: string;
  windowDays: number;
  label: string;
  amount?: number;
  source: string;
  /**
   * Cómo se supo. `null`/ausente significa OBSERVADO, y no es un detalle: un desenlace inferido
   * sobre un rechazado, contado junto a los observados, calibra el modelo contra la población que ya
   * se aprobó y lo hace parecer perfecto.
   */
  inferenceMethod?: string;
  notes?: string;
};

/** El veredicto del motor para UNA fila de desenlace. */
export type FacilityOutcomeResult = {
  externalReference: string;
  windowDays: number;
  accepted: boolean;
  /** `OUTCOME_CONFLICT`, `FACILITY_NOT_FOUND`… o `null` si se aceptó. */
  reason: string | null;
  /** Ya estaba observado igual: no se reescribió ni contó, y es un éxito. */
  duplicate: boolean;
};
