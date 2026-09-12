/**
 * @file AT-041 — el consumidor de notificaciones con inbox: evento duplicado → una intención de entrega.
 * @business Reentregar el mismo evento no produce un segundo aviso; el consumidor recibe valores, no el modelo.
 * @system PostgreSQL real: `LocalConsumerDispatchPublisher` + `NotificationEventConsumer` con un doble del
 *   orquestador que cuenta intenciones; la deduplicación es el recibo del inbox.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { NotificationEventConsumer } from '../../../src/modules/notifications/infrastructure/notification-event.consumer.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import { fromOutboxRow } from '../../../src/platform/events/integration-event.js';
import { LocalConsumerDispatchPublisher } from '../../../src/platform/events/outbox-relay.service.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const producer = `it-notif-${runToken()}`;
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

describe('AT-041 · consumidor de notificaciones con inbox', () => {
  it('evento duplicado: una intención de entrega; crash antes del commit: se reintenta', async () => {
    if (!database) return;
    const now = new Date();
    const row = await OutboxEventModel.create({
      tenantId: null,
      aggregateType: 'credit_application',
      aggregateId: 'n-1',
      aggregateVersion: 1,
      eventCode: 'credit.application.submitted',
      eventPayloadJson: { applicationCode: 'CRA-1' },
      eventFamily: 'domain',
      eventVersion: 1,
      schemaVersion: 1,
      producer,
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      availableAt: now,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
    const intents: string[] = [];
    let failFirst = true;
    const orchestrator = {
      handleEvent: async (event: { eventId: string }) => {
        if (failFirst) {
          failFirst = false;
          throw new Error('crash antes del commit');
        }
        intents.push(event.eventId);
      },
    };
    const consumer = new NotificationEventConsumer(orchestrator as never);
    const publisher = new LocalConsumerDispatchPublisher(database.sequelize, new ConsumerRegistry([consumer]));
    const event = fromOutboxRow(row);
    expect((await publisher.publish(event)).accepted).toBe(false); // crash: sin recibo, sin intención
    expect((await publisher.publish(event)).accepted).toBe(true); // reintento: procesa
    expect((await publisher.publish(event)).accepted).toBe(true); // duplicado: no-op por inbox
    expect(intents).toHaveLength(1);
    expect(await InboxReceiptModel.count({ where: { eventId: event.eventId, consumerId: 'notifications.orchestrator' } })).toBe(1);
  });
});
