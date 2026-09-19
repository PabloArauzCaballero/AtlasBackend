/**
 * @file AT-036 — orden por agregado, DLQ y replay autorizado, con PostgreSQL real.
 * @business Versión 3 antes que 2: se espera, no se aplica un estado incorrecto; un error permanente va
 *   a la DLQ sin reintento infinito; un replay de otro tenant se deniega.
 * @system `LocalConsumerDispatchPublisher` + `OutboxRelayService` sobre la base de integración.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../../src/platform/events/event-consumer.port.js';
import { fromOutboxRow } from '../../../src/platform/events/integration-event.js';
import { LocalConsumerDispatchPublisher, OutboxRelayService } from '../../../src/platform/events/outbox-relay.service.js';
import { authorizeReplay } from '../../../src/platform/events/retry-policy.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const producer = `it-order-${runToken()}`;

beforeAll(async () => {
  database = await openIntegrationDatabase();
});
afterAll(async () => {
  if (database) {
    await InboxReceiptModel.destroy({ where: { producer } });
    await OutboxEventModel.destroy({ where: { producer } });
  }
  await database?.close();
});

async function seed(version: number, status = 'pending', schemaVersion = 1) {
  const now = new Date();
  return OutboxEventModel.create({
    tenantId: null,
    aggregateType: 'credit_application',
    aggregateId: 'agg-order',
    aggregateVersion: version,
    eventCode: 'credit.application.submitted',
    eventPayloadJson: { version },
    eventFamily: 'domain',
    eventVersion: 1,
    schemaVersion,
    producer,
    status,
    attempts: status === 'pending' ? 0 : 1,
    maxAttempts: 3,
    availableAt: now,
    processedAt: null,
    lastError: null,
    correlationId: null,
    createdAtValue: now,
    updatedAtValue: now,
  } as never);
}

const applied: number[] = [];
const consumer: EventConsumer = {
  consumerId: 'order-consumer',
  subscriptions: { 'credit.application.submitted': [1] },
  handle: async (event) => {
    applied.push(event.aggregate.version ?? -1);
  },
};

describe('AT-036 · orden, DLQ y replay', () => {
  it('versión 3 llega antes que 2: espera (reintento), y se aplica cuando llega la 2', async () => {
    if (!database) return;
    const publisher = new LocalConsumerDispatchPublisher(database.sequelize, new ConsumerRegistry([consumer]));
    const v1 = await seed(1, 'processing');
    const v3 = await seed(3, 'processing');
    const v2 = await seed(2, 'processing');
    expect((await publisher.publish(fromOutboxRow(v1))).accepted).toBe(true);
    const gap = await publisher.publish(fromOutboxRow(v3));
    expect(gap).toMatchObject({ accepted: false, permanent: false });
    expect(gap.accepted ? '' : gap.reason).toContain('ORDER_GAP:2');
    expect((await publisher.publish(fromOutboxRow(v2))).accepted).toBe(true);
    expect((await publisher.publish(fromOutboxRow(v3))).accepted).toBe(true);
    expect(applied).toEqual([1, 2, 3]);
  });

  it('versión de esquema que ningún consumidor entiende: cuarentena (failed, EVENT_QUARANTINED), sin bucle', async () => {
    if (!database) return;
    const row = await seed(4, 'pending', 9);
    const relay = new OutboxRelayService(database.sequelize, [consumer]);
    const result = await relay.run({ tenantId: null, limit: 5, workerId: 'q' });
    expect(result.quarantined).toBeGreaterThanOrEqual(1);
    const stored = await OutboxEventModel.findOne({ where: { eventId: row.eventId } as never });
    expect(stored?.status).toBe('failed');
    expect(stored?.errorCode).toBe('EVENT_QUARANTINED');
  });

  it('replay administrativo: denegado sin permiso o desde otro tenant; permitido con ambos', () => {
    expect(authorizeReplay({ tenantId: '2', permissions: ['events.dead_letter.replay'] }, { tenantId: '1' }).allowed).toBe(false);
    expect(authorizeReplay({ tenantId: '1', permissions: [] }, { tenantId: '1' }).allowed).toBe(false);
    expect(authorizeReplay({ tenantId: '1', permissions: ['events.dead_letter.replay'] }, { tenantId: '1' }).allowed).toBe(true);
  });
});
