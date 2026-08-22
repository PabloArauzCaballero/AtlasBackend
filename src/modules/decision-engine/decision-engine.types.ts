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
export const decisionReasonSchema = z
  .object({
    code: z.string(),
    category: z.string().nullish(),
    message: z.string().nullish(),
    adverseAction: z.boolean().nullish(),
    priority: z.number().nullish(),
  })
  .passthrough();

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
  context?: Record<string, unknown>;
};

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
  | { kind: 'review'; response: DecisionResponse }
  | { kind: 'engineUnavailable'; reason: string };

export type OutcomeObservationInput = {
  executionId: string;
  windowDays: number;
  label: string;
  amount?: number;
  source: string;
  notes?: string;
};
