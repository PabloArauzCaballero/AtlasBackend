/**
 * @file Atributos de los spans de mensajería del outbox, definidos una sola vez.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system traduce un evento de integración a atributos semánticos sin exponer su contenido.
 */
import type { Attributes } from '@opentelemetry/api';
import { APP_ATTRIBUTES, MESSAGING_ATTRIBUTES, MESSAGING_DESTINATION, MESSAGING_SYSTEM } from '../../observability/telemetry.constants.js';

/**
 * Productor y consumidor tienen que coincidir literalmente en estos nombres o la traza se lee
 * partida en dos mitades que nada relaciona, y sin producir ningún error. Por eso viven aquí y no
 * en cada extremo.
 *
 * Nada de lo que se publica describe el CONTENIDO del evento: sólo su tipo, su agregado y su
 * intento. El payload puede llevar datos de una persona; el tipo, nunca.
 */
export type MessagingSpanInput = Readonly<{
  eventType: string;
  aggregateType: string;
  /**
   * Identificador del agregado. Es la pregunta literal de soporte —«dame la traza de la
   * solicitud CRA-1»— y sin él una traza de despacho no se puede atar a su caso. Es un
   * identificador interno opaco, no un dato personal.
   */
  aggregateId?: string | null;
  /** Módulo que publicó el hecho. Sólo en el productor. */
  producer?: string;
  /** Número de intento. Sólo en el consumidor: responde «¿por qué llegó tarde?». */
  attempt?: number;
}>;

export function outboxProducerAttributes(input: MessagingSpanInput): Attributes {
  return {
    ...base(input),
    [MESSAGING_ATTRIBUTES.operationType]: 'send',
    ...(input.producer === undefined ? {} : { [APP_ATTRIBUTES.module]: input.producer }),
  };
}

export function outboxConsumerAttributes(input: MessagingSpanInput): Attributes {
  return {
    ...base(input),
    [MESSAGING_ATTRIBUTES.operationType]: 'process',
    ...(input.attempt === undefined ? {} : { [APP_ATTRIBUTES.jobAttempt]: input.attempt }),
  };
}

function base(input: MessagingSpanInput): Attributes {
  return {
    [MESSAGING_ATTRIBUTES.system]: MESSAGING_SYSTEM,
    [MESSAGING_ATTRIBUTES.destinationName]: MESSAGING_DESTINATION,
    [APP_ATTRIBUTES.eventType]: input.eventType,
    [APP_ATTRIBUTES.entityType]: input.aggregateType,
    ...(input.aggregateId === null || input.aggregateId === undefined ? {} : { [APP_ATTRIBUTES.entityId]: input.aggregateId }),
  };
}
