/**
 * @file Registro de consumidores (AT-035): se ensambla en composición y valida duplicados.
 * @business Dos consumidores con la misma identidad compartirían recibos y uno se comería los eventos del otro.
 * @system Valor inmutable; `consumersFor(type, version)` devuelve los que entienden ese tipo y versión.
 */
import type { EventConsumer } from './event-consumer.port.js';

export class ConsumerRegistry {
  private readonly byId = new Map<string, EventConsumer>();

  constructor(consumers: readonly EventConsumer[]) {
    for (const consumer of consumers) {
      if (!/^[a-z][a-z0-9._-]{2,119}$/.test(consumer.consumerId)) throw new Error(`CONSUMER_ID_INVALID: ${consumer.consumerId}`);
      if (this.byId.has(consumer.consumerId)) throw new Error(`CONSUMER_ID_DUPLICATED: ${consumer.consumerId}`);
      for (const [type, versions] of Object.entries(consumer.subscriptions)) {
        if (versions.length === 0) throw new Error(`CONSUMER_SUBSCRIPTION_WITHOUT_VERSIONS: ${consumer.consumerId} ${type}`);
      }
      this.byId.set(consumer.consumerId, consumer);
    }
  }

  all(): readonly EventConsumer[] {
    return [...this.byId.values()];
  }

  /** Consumidores del tipo; `incompatible` son los suscritos que NO entienden esta versión (cuarentena). */
  consumersFor(type: string, schemaVersion: number): { ready: EventConsumer[]; incompatible: EventConsumer[] } {
    const ready: EventConsumer[] = [];
    const incompatible: EventConsumer[] = [];
    for (const consumer of this.byId.values()) {
      // `*`: el consumidor recibe todos los tipos (los eventos técnicos nunca llegan aquí: el relay los excluye).
      const versions = consumer.subscriptions[type] ?? consumer.subscriptions['*'];
      if (!versions) continue;
      (versions.includes(schemaVersion) ? ready : incompatible).push(consumer);
    }
    return { ready, incompatible };
  }
}
