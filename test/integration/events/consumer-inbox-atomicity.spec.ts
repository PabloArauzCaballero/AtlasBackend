/**
 * @file AT-035 — recibo y efecto local se confirman juntos; dos consumidores procesan una vez cada uno.
 * @business Un evento recibido dos veces por el mismo consumidor produce UN efecto; dos consumidores del
 *   mismo evento lo procesan ambos; un crash antes del commit deja reintentar, después del commit no repite.
 * @system PostgreSQL real con `LocalConsumerDispatchPublisher` y consumidores que escriben en una tabla
 *   de efectos (el outbox técnico sirve de tabla de efectos, con un código propio).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../../src/platform/events/event-consumer.port.js';
import { fromOutboxRow } from '../../../src/platform/events/integration-event.js';
import { LocalConsumerDispatchPublisher } from '../../../src/platform/events/outbox-relay.service.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const producer = `it-inbox-${runToken()}`;
const EFFECT = `test.effect.${runToken()}`;

beforeAll(async () => {
  database = await openIntegrationDatabase();
});
afterAll(async () => {
  if (database) {
    await InboxReceiptModel.destroy({ where: { producer } });
    await OutboxEventModel.destroy({ where: { producer } });
    await OutboxEventModel.destroy({ where: { eventCode: EFFECT } });
  }
  await database?.close();
});

async function seedEvent(version = 1, aggregateId = 'agg-1') {
  const now = new Date();
  return OutboxEventModel.create({
    tenantId: null,
    aggregateType: 'credit_application',
    aggregateId,
    aggregateVersion: version,
    eventCode: 'credit.application.submitted',
    eventPayloadJson: {},
    eventFamily: 'domain',
    eventVersion: 1,
    schemaVersion: 1,
    producer,
    status: 'processing',
    attempts: 1,
    maxAttempts: 3,
    availableAt: now,
    processedAt: null,
    lastError: null,
    correlationId: null,
    createdAtValue: now,
    updatedAtValue: now,
  } as never);
}

/** Consumidor que escribe un «efecto» (fila del outbox con código propio) en la transacción que recibe. */
function effectConsumer(consumerId: string, options: { failAfterWrite?: boolean } = {}): EventConsumer {
  return {
    consumerId,
    subscriptions: { 'credit.application.submitted': [1] },
    async handle(event, transaction) {
      const now = new Date();
      await OutboxEventModel.create(
        {
          tenantId: null,
          aggregateType: 'effect',
          aggregateId: consumerId,
          eventCode: EFFECT,
          eventPayloadJson: { eventId: event.eventId },
          eventFamily: 'test',
          eventVersion: 1,
          status: 'processed',
          attempts: 0,
          availableAt: now,
          createdAtValue: now,
          updatedAtValue: now,
        } as never,
        { transaction },
      );
      if (options.failAfterWrite) throw new Error('crash antes del commit');
    },
  };
}

async function effects(consumerId: string, eventId: string): Promise<number> {
  const rows = await database!.sequelize.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM platform_ops.outbox_events WHERE event_code = $code AND aggregate_id = $consumerId AND event_payload_json->>'eventId' = $eventId`,
    { type: QueryTypes.SELECT, bind: { code: EFFECT, consumerId, eventId } },
  );
  return Number(rows[0]?.n);
}

describe('AT-035 · inbox por consumidor', () => {
  it('el mismo evento entregado dos veces al mismo consumidor: un efecto, un recibo', async () => {
    if (!database) return;
    const row = await seedEvent();
    const publisher = new LocalConsumerDispatchPublisher(database.sequelize, new ConsumerRegistry([effectConsumer('notifications')]));
    const event = fromOutboxRow(row);
    expect((await publisher.publish(event)).accepted).toBe(true);
    expect((await publisher.publish(event)).accepted).toBe(true);
    expect(await effects('notifications', event.eventId)).toBe(1);
    expect(await InboxReceiptModel.count({ where: { eventId: event.eventId } })).toBe(1);
  });

  it('dos consumidores del mismo evento: ambos procesan una vez sin bloquearse por un processed global', async () => {
    if (!database) return;
    const row = await seedEvent(1, 'agg-2');
    const publisher = new LocalConsumerDispatchPublisher(
      database.sequelize,
      new ConsumerRegistry([effectConsumer('notifications'), effectConsumer('audit')]),
    );
    const event = fromOutboxRow(row);
    expect((await publisher.publish(event)).accepted).toBe(true);
    expect(await effects('notifications', event.eventId)).toBe(1);
    expect(await effects('audit', event.eventId)).toBe(1);
    expect(await InboxReceiptModel.count({ where: { eventId: event.eventId } })).toBe(2);
  });

  it('crash antes del commit: ni recibo ni efecto → el reintento procesa; después: el inbox evita repetir', async () => {
    if (!database) return;
    const row = await seedEvent(1, 'agg-3');
    const event = fromOutboxRow(row);
    const crashing = new LocalConsumerDispatchPublisher(
      database.sequelize,
      new ConsumerRegistry([effectConsumer('audit', { failAfterWrite: true })]),
    );
    const first = await crashing.publish(event);
    expect(first.accepted).toBe(false);
    expect(await effects('audit', event.eventId)).toBe(0);
    expect(await InboxReceiptModel.count({ where: { eventId: event.eventId, consumerId: 'audit' } })).toBe(0);
    const healthy = new LocalConsumerDispatchPublisher(database.sequelize, new ConsumerRegistry([effectConsumer('audit')]));
    expect((await healthy.publish(event)).accepted).toBe(true);
    expect((await healthy.publish(event)).accepted).toBe(true);
    expect(await effects('audit', event.eventId)).toBe(1);
  });
});
