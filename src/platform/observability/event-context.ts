/**
 * @file Contexto de observabilidad de eventos (AT-048): correlación y causación atraviesan productor, relay y consumidor.
 * @business Un aviso al cliente se puede seguir hasta la petición HTTP que lo originó sin que ningún
 *   identificador de cliente acabe como etiqueta de métrica.
 * @system Funciones puras: derivar el contexto de un evento hijo a partir del padre (mismo `correlationId`,
 *   `causationId` = `eventId` del padre) y etiquetas de métrica de baja cardinalidad (tipo, productor,
 *   consumidor, resultado; nunca tenant, cliente ni eventId).
 */
import type { IntegrationEvent } from '../events/integration-event.js';

export type EventContext = Readonly<{ correlationId: string | null; causationId: string | null; traceparent: string | null }>;

/** Contexto para un evento producido a raíz de otro: hereda la correlación y apunta al padre como causa. */
export function childContextOf(parent: IntegrationEvent, traceparent: string | null = null): EventContext {
  return Object.freeze({ correlationId: parent.correlationId, causationId: parent.eventId, traceparent });
}

/** Contexto para un evento producido por una petición HTTP: la correlación de la petición, sin causa previa. */
export function contextFromRequest(input: { correlationId: string | null; traceparent?: string | null }): EventContext {
  return Object.freeze({ correlationId: input.correlationId, causationId: null, traceparent: input.traceparent ?? null });
}

const HIGH_CARDINALITY = /^(tenantId|customerId|eventId|correlationId|causationId|recipientId|aggregateId)$/;

/** Etiquetas permitidas en métricas de eventos: rechaza cualquier identificador de alta cardinalidad. */
export function metricLabels(input: Record<string, string | number | boolean | null | undefined>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (HIGH_CARDINALITY.test(key)) throw new Error(`METRIC_LABEL_HIGH_CARDINALITY: ${key}`);
    if (value !== null && value !== undefined) labels[key] = String(value);
  }
  return labels;
}

/** Métricas de la cola (nombres estables): edad del outbox, lag, intentos, DLQ, rechazos idempotentes. */
export const EVENT_METRICS = Object.freeze({
  outboxAgeSeconds: 'atlas_outbox_oldest_pending_age_seconds',
  relayPublished: 'atlas_outbox_relay_events_total',
  consumerLagSeconds: 'atlas_consumer_lag_seconds',
  deadLettered: 'atlas_outbox_dead_letter_total',
  idempotencyRejected: 'atlas_idempotency_rejections_total',
});
