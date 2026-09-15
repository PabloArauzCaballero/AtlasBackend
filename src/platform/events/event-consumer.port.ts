/**
 * @file Puerto de consumidor de eventos e inbox (AT-035).
 * @business Cada consumidor tiene identidad estable y recuerda lo que ya procesó; el recibo y el efecto
 *   local se confirman juntos, así que una reentrega no repite el efecto.
 * @system `handle` recibe una transacción de la base del consumidor (hoy la compartida) para escribir su
 *   efecto; el relay escribe el recibo en esa misma transacción.
 */
import type { Transaction } from 'sequelize';
import type { IntegrationEvent } from './integration-event.js';

export interface EventConsumer {
  readonly consumerId: string;
  /** Tipos (`event_code`) que consume, con las versiones de esquema que entiende. */
  readonly subscriptions: Readonly<Record<string, readonly number[]>>;
  handle(event: IntegrationEvent, transaction: Transaction): Promise<void>;
}

export const EVENT_CONSUMERS = 'atlas.platform.event-consumers';
