/**
 * @file AT-059 — corte de escritor único: el proceso viejo queda cercado, lo en vuelo se procesa una vez
 *   lógica y ningún evento pendiente se pierde al cambiar de dueño.
 * @business Durante el corte hay dos procesos vivos (monolito y piloto). Sólo uno reclama y confirma;
 *   el otro ve la época nueva y se detiene. Un evento que el viejo publicó sin confirmar se reentrega y
 *   el inbox lo deduplica; un evento pendiente de antes del corte lo entrega el nuevo dueño.
 * @system PostgreSQL real: `ContextOwnershipRegistry.transfer` (UPDATE condicional + requeue de en vuelo),
 *   dos `OutboxRelayService` con identidades distintas y un consumidor con inbox.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../../src/platform/events/event-consumer.port.js';
import { fromOutboxRow } from '../../../src/platform/events/integration-event.js';
import { LocalConsumerDispatchPublisher, OutboxRelayService } from '../../../src/platform/events/outbox-relay.service.js';
import { ContextOwnershipRegistry, OwnershipFencedError } from '../../../src/platform/ownership/context-ownership.registry.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let registry: ContextOwnershipRegistry;
const producer = `it-cutover-${runToken()}`;
const CONSUMER = 'cutover.consumer';
const effects = new Map<string, number>();

const consumer: EventConsumer = {
  consumerId: CONSUMER,
  subscriptions: { 'credit.application.submitted': [1] },
  async handle(event) {
    effects.set(event.eventId, (effects.get(event.eventId) ?? 0) + 1);
  },
};

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) registry = new ContextOwnershipRegistry(database.sequelize);
});
afterAll(async () => {
  if (database) {
    // Pase lo que pase, el dueño vuelve a ser el monolito (estado de partida de todas las suites).
    const current = await registry.current('messaging');
    if (current && current.owner !== 'monolith') {
      await registry.transfer({
        context: 'messaging',
        from: current.owner,
        to: 'monolith',
        expectedEpoch: current.epoch,
        changedBy: 'test-restore',
        requeueInFlight: true,
      });
    }
    await InboxReceiptModel.destroy({ where: { consumerId: CONSUMER } });
    await OutboxEventModel.destroy({ where: { producer } });
  }
  await database?.close();
});

async function seed(aggregateId: string) {
  const now = new Date();
  return OutboxEventModel.create({
    tenantId: null,
    aggregateType: 'credit_application',
    aggregateId,
    aggregateVersion: 1,
    eventCode: 'credit.application.submitted',
    eventPayloadJson: {},
    eventFamily: 'domain',
    eventVersion: 1,
    schemaVersion: 1,
    producer,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    availableAt: now,
    createdAtValue: now,
    updatedAtValue: now,
  } as never);
}

describe('AT-059 · corte con escritor único', () => {
  it('el monolito es el dueño inicial de Mensajería (sembrado por la migración)', async () => {
    if (!database) return;
    const current = await registry.current('messaging');
    expect(current?.owner).toBe('monolith');
    expect(current!.epoch).toBeGreaterThanOrEqual(1);
  });

  it('corte completo: viejo cercado, en vuelo una vez lógica, pendiente legado entregado por el nuevo dueño', async () => {
    if (!database) return;
    const sequelize = database.sequelize;
    const publisher = new LocalConsumerDispatchPublisher(sequelize, new ConsumerRegistry([consumer]));
    const inFlight = await seed('in-flight');
    const legacyPending = await seed('legacy-pending');
    const start = (await registry.current('messaging'))!;

    // 1. El escritor viejo (monolito) reclama el evento en vuelo y lo publica, pero muere antes de confirmar.
    const oldWriter = new OutboxRelayService(sequelize, [], publisher, undefined, undefined, registry);
    const { ownerToken: oldToken, rows } = await oldWriter.claim({ tenantId: null, limit: 1, workerId: 'monolith-old' });
    expect(rows.map((row) => row.eventId)).toEqual([inFlight.eventId]);
    expect((await publisher.publish(fromOutboxRow(rows[0]))).accepted).toBe(true);

    // 2. Con cola no drenada la transferencia se niega, salvo que se pida el requeue explícito.
    await expect(
      registry.transfer({ context: 'messaging', from: 'monolith', to: 'messaging-worker', expectedEpoch: start.epoch, changedBy: 'test' }),
    ).rejects.toThrow(/OWNERSHIP_QUEUE_NOT_DRAINED/);
    const transfer = await registry.transfer({
      context: 'messaging',
      from: 'monolith',
      to: 'messaging-worker',
      expectedEpoch: start.epoch,
      changedBy: 'test',
      requeueInFlight: true,
    });
    expect(transfer.ownership.epoch).toBe(start.epoch + 1);
    expect(transfer.requeued).toBeGreaterThanOrEqual(1);

    // 3. El viejo sigue vivo: no confirma con su testigo ni reclama con su identidad.
    expect(await oldWriter.complete(rows[0], oldToken, { status: 'processed', processedAt: new Date() })).toBe(false);
    const fenced = await oldWriter.run({
      tenantId: null,
      limit: 10,
      workerId: 'monolith-old',
      ownership: { context: 'messaging', owner: 'monolith' },
    });
    expect(fenced.fenced).toBe(true);
    expect(fenced.claimed).toBe(0);
    // Una segunda transferencia con la época vieja tampoco pasa.
    await expect(
      registry.transfer({ context: 'messaging', from: 'monolith', to: 'messaging-worker', expectedEpoch: start.epoch, changedBy: 'test' }),
    ).rejects.toBeInstanceOf(OwnershipFencedError);

    // 4. El nuevo dueño entrega: el en vuelo se reentrega y el inbox lo deduplica; el pendiente legado sale una vez.
    const newWriter = new OutboxRelayService(sequelize, [], publisher, undefined, undefined, registry);
    const result = await newWriter.run({
      tenantId: null,
      limit: 10,
      workerId: 'messaging-worker-1',
      ownership: { context: 'messaging', owner: 'messaging-worker' },
    });
    expect(result.fenced).toBe(false);
    expect(result.published).toBe(2);
    expect(effects.get(inFlight.eventId)).toBe(1);
    expect(effects.get(legacyPending.eventId)).toBe(1);
    expect(await InboxReceiptModel.count({ where: { consumerId: CONSUMER, eventId: inFlight.eventId } })).toBe(1);
    for (const row of await OutboxEventModel.findAll({ where: { producer } })) expect(row.status).toBe('processed');
  });
});
