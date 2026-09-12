/**
 * @file AT-048 — correlación y causación atraviesan productor → relay → consumidor; sin etiquetas de alta cardinalidad.
 * @business Un aviso se rastrea hasta su petición de origen; las métricas no explotan por cliente.
 * @system Outbox real (escritor + relay + consumidor que captura el sobre) y `metricLabels`.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../../src/platform/events/event-consumer.port.js';
import type { IntegrationEvent } from '../../../src/platform/events/integration-event.js';
import { LocalConsumerDispatchPublisher, OutboxRelayService } from '../../../src/platform/events/outbox-relay.service.js';
import { SequelizeOutboxWriter } from '../../../src/platform/events/sequelize-outbox-writer.js';
import { childContextOf, contextFromRequest, metricLabels } from '../../../src/platform/observability/event-context.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const producer = `it-trace-${runToken()}`;
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

describe('propagación de traza en eventos (AT-048)', () => {
  it('el consumidor recibe la correlación de la petición y el eventId del productor como causación del hijo', async () => {
    if (!database) return;
    const received: IntegrationEvent[] = [];
    const consumer: EventConsumer = {
      consumerId: 'trace-consumer',
      subscriptions: { '*': [1] },
      handle: async (event) => {
        received.push(event);
      },
    };
    const request = contextFromRequest({ correlationId: `corr-${runToken()}` });
    await database.sequelize.transaction(async (transaction) => {
      await new SequelizeOutboxWriter(OutboxEventModel, transaction).append({
        type: 'credit.application.submitted',
        scope: { kind: 'platform' },
        aggregate: { type: 'credit_application', id: 't-1', version: 1 },
        producer,
        payload: {},
        correlationId: request.correlationId,
        causationId: request.causationId,
      });
    });
    const relay = new OutboxRelayService(
      database.sequelize,
      [],
      new LocalConsumerDispatchPublisher(database.sequelize, new ConsumerRegistry([consumer])),
    );
    // Sólo el productor de esta prueba: el reclamo es global, así que se filtra por producer al comprobar.
    await relay.run({ tenantId: null, limit: 50, workerId: 'trace' });
    const mine = received.find((event) => event.producer === producer);
    expect(mine?.correlationId).toBe(request.correlationId);
    expect(mine?.causationId).toBeNull();
    const child = childContextOf(mine!);
    expect(child).toEqual({ correlationId: request.correlationId, causationId: mine!.eventId, traceparent: null });
  });

  it('las etiquetas de métrica rechazan identificadores de alta cardinalidad', () => {
    expect(metricLabels({ type: 'credit.application.submitted', consumer: 'notifications', outcome: 'processed' })).toEqual({
      type: 'credit.application.submitted',
      consumer: 'notifications',
      outcome: 'processed',
    });
    expect(() => metricLabels({ tenantId: '1' })).toThrow('METRIC_LABEL_HIGH_CARDINALITY: tenantId');
    expect(() => metricLabels({ customerId: '42' })).toThrow('METRIC_LABEL_HIGH_CARDINALITY: customerId');
  });
});
