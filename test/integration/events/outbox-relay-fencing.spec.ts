/**
 * @file AT-034 — dos relays reparten filas sin perder eventos; un lease viejo no cierra trabajo ajeno;
 *   publicar y caer antes del ACK reentrega la misma identidad.
 * @business Ningún evento se pierde ni se procesa por dos relays a la vez; un relay muerto no puede
 *   marcar como publicado lo que otro recuperó.
 * @system PostgreSQL real: dos `OutboxRelayService` con un publicador de prueba que cuenta entregas por
 *   `event_id`; el reclamo es `FOR UPDATE SKIP LOCKED` + `owner_token`; el cierre es condicional.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { OutboxEventModel } from '../../../src/database/models/index.js';
import { OutboxRelayService } from '../../../src/platform/events/outbox-relay.service.js';
import type { EventPublisher } from '../../../src/platform/events/event-publisher.port.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const marker = `credit.application.submitted`;
const producer = `it-relay-${runToken()}`;

beforeAll(async () => {
  database = await openIntegrationDatabase();
});
afterAll(async () => {
  if (database) await OutboxEventModel.destroy({ where: { producer } });
  await database?.close();
});

async function seed(count: number): Promise<string[]> {
  const now = new Date();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = await OutboxEventModel.create({
      tenantId: null,
      aggregateType: 'credit_application',
      aggregateId: String(index),
      aggregateVersion: 1,
      eventCode: marker,
      eventPayloadJson: { index },
      eventFamily: 'domain',
      eventVersion: 1,
      schemaVersion: 1,
      producer,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      processedAt: null,
      lastError: null,
      correlationId: null,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
    ids.push(row.eventId);
  }
  return ids;
}

function countingPublisher(): EventPublisher & { seen: Map<string, number> } {
  const seen = new Map<string, number>();
  return {
    seen,
    publish: async (event) => {
      seen.set(event.eventId, (seen.get(event.eventId) ?? 0) + 1);
      return { accepted: true, transport: 'test' };
    },
  };
}

describe('AT-034 · relay con lease y fencing', () => {
  it('dos relays concurrentes: cada evento lo publica exactamente uno; ninguno se pierde', async () => {
    if (!database) return;
    const ids = await seed(6);
    const publisher = countingPublisher();
    const relayA = new OutboxRelayService(database.sequelize, [], publisher);
    const relayB = new OutboxRelayService(database.sequelize, [], publisher);
    const [a, b] = await Promise.all([
      relayA.run({ tenantId: null, limit: 3, workerId: 'A' }),
      relayB.run({ tenantId: null, limit: 3, workerId: 'B' }),
    ]);
    expect(a.claimed + b.claimed).toBe(6);
    for (const id of ids) expect(publisher.seen.get(id)).toBe(1);
    const rows = await OutboxEventModel.findAll({ where: { producer } });
    expect(rows.every((row) => row.status === 'processed')).toBe(true);
  });

  it('un relay viejo cuyo lease fue recuperado no puede cerrar el evento (0 filas), y el nuevo sí', async () => {
    if (!database) return;
    const [eventId] = await seed(1);
    const relay = new OutboxRelayService(database.sequelize, [], countingPublisher());
    const { ownerToken: oldToken, rows } = await relay.claim({ tenantId: null, limit: 1, workerId: 'old' });
    expect(rows).toHaveLength(1);
    // Simula la recuperación por otro relay: nuevo testigo sobre la misma fila (lo que haría el reclaim tras vencer el lease).
    const newToken = randomUUID().replace(/-/g, '');
    await OutboxEventModel.update({ ownerToken: newToken, lockedBy: 'new' }, { where: { eventId } as never });
    expect(await relay.complete(rows[0], oldToken, { status: 'processed', processedAt: new Date() })).toBe(false);
    expect(await relay.complete(rows[0], newToken, { status: 'processed', processedAt: new Date() })).toBe(true);
    const row = await OutboxEventModel.findOne({ where: { eventId } as never });
    expect(row?.status).toBe('processed');
  });

  it('publicación aceptada y caída antes del ACK local: la reentrega lleva la MISMA identidad', async () => {
    if (!database) return;
    const [eventId] = await seed(1);
    const publisher = countingPublisher();
    const relay = new OutboxRelayService(database.sequelize, [], publisher);
    const { rows } = await relay.claim({ tenantId: null, limit: 1, workerId: 'crash' });
    await publisher.publish((await import('../../../src/platform/events/integration-event.js')).fromOutboxRow(rows[0]));
    // El proceso muere aquí: no llega a `complete`. El reclaim devuelve la fila a pending (lease vencido).
    await OutboxEventModel.update({ status: 'pending', lockedAt: null, lockedBy: null, ownerToken: null }, { where: { eventId } as never });
    await relay.run({ tenantId: null, limit: 1, workerId: 'after-crash' });
    expect(publisher.seen.get(eventId)).toBe(2); // mismo event_id dos veces: el consumidor lo deduplica por inbox, no es un hecho nuevo
    expect((await OutboxEventModel.findOne({ where: { eventId } as never }))?.status).toBe('processed');
  });

  it('transporte caído: el negocio confirmado conserva el evento pendiente con reintento programado', async () => {
    if (!database) return;
    const [eventId] = await seed(1);
    const down: EventPublisher = { publish: async () => ({ accepted: false, transport: 'test', reason: 'BROKER_DOWN', permanent: false }) };
    const result = await new OutboxRelayService(database.sequelize, [], down).run({ tenantId: null, limit: 1, workerId: 'x' });
    expect(result.retried).toBe(1);
    const row = await OutboxEventModel.findOne({ where: { eventId } as never });
    expect(row?.status).toBe('pending');
    expect(row!.availableAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
