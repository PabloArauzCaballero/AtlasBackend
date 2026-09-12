/**
 * @file Puerto de publicación al transporte (AT-034).
 * @business El relay entrega el evento al transporte y recibe un ACK; «publicado al transporte» no es
 *   «procesado por todos los consumidores».
 * @system Interfaz + token. Implementaciones: despacho local durable a consumidores registrados (monolito)
 *   y, mañana, un broker. Ninguna simula durabilidad con un emisor en memoria.
 */
import type { IntegrationEvent } from './integration-event.js';

export type PublishAck = Readonly<
  { accepted: true; transport: string } | { accepted: false; transport: string; reason: string; permanent: boolean }
>;

export interface EventPublisher {
  publish(event: IntegrationEvent): Promise<PublishAck>;
}

export const EVENT_PUBLISHER = 'atlas.platform.event-publisher';
