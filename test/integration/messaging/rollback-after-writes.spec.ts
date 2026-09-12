/**
 * @file AT-060 — reversión DESPUÉS de escrituras nuevas del piloto: nada confirmado se pierde, nada aceptado se repite.
 * @business Tras el corte, el piloto escribe. Si hay que volver atrás, lo que escribió sigue visible y procesable
 *   por el monolito; lo que ya entregó no se entrega otra vez; y de los dos escritores sólo uno queda dueño.
 * @system Transferencia inversa por época (`ContextOwnershipRegistry.transfer`) sobre PostgreSQL real; el
 *   piloto produce un evento nuevo (fila del outbox con `producer='messaging-worker'`) y entrega otro con
 *   recibo de inbox; el monolito retoma y el inbox deduplica.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../../src/platform/events/event-consumer.port.js';
import { LocalConsumerDispatchPublisher, OutboxRelayService } from '../../../src/platform/events/outbox-relay.service.js';
import { ContextOwnershipRegistry } from '../../../src/platform/ownership/context-ownership.registry.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let registry: ContextOwnershipRegistry;
const token = runToken();
const PRODUCER_MONOLITH = `it-rb-monolith-${token}`;
const PRODUCER_PILOT = `it-rb-pilot-${token}`;
const CONSUMER = 'rollback.consumer';
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
    await OutboxEventModel.destroy({ where: { producer: [PRODUCER_MONOLITH, PRODUCER_PILOT] } as never });
  }
  await database?.close();
});

async function seed(producer: string, aggregateId: string) {
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

describe('AT-060 · rollback tras escrituras nuevas', () => {
  it('lo escrito por el piloto sigue vivo tras volver al monolito; lo entregado no se repite; el piloto queda cercado', async () => {
    if (!database) return;
    const sequelize = database.sequelize;
    const publisher = new LocalConsumerDispatchPublisher(sequelize, new ConsumerRegistry([consumer]));
    const start = (await registry.current('messaging'))!;
    expect(start.owner).toBe('monolith');

    // Corte hacia el piloto.
    const toPilot = await registry.transfer({
      context: 'messaging',
      from: 'monolith',
      to: 'messaging-worker',
      expectedEpoch: start.epoch,
      changedBy: 'test',
      requeueInFlight: true,
    });
    const pilot = new OutboxRelayService(sequelize, [], publisher, undefined, undefined, registry);

    // Escrituras SOLO posteriores al corte: (a) un evento que el piloto entrega (aceptado por el «proveedor» = consumidor con recibo);
    // (b) un evento nuevo producido por el piloto que aún no se ha procesado cuando se decide revertir.
    const delivered = await seed(PRODUCER_PILOT, 'delivered-by-pilot');
    const run = await pilot.run({
      tenantId: null,
      limit: 10,
      workerId: 'pilot',
      ownership: { context: 'messaging', owner: 'messaging-worker' },
    });
    expect(run.published).toBe(1);
    expect(effects.get(delivered.eventId)).toBe(1);
    const createdOnlyInPilot = await seed(PRODUCER_PILOT, 'created-only-in-pilot');

    // Falla la versión nueva: reversión por transferencia inversa (época nueva), no por DNS.
    const back = await registry.transfer({
      context: 'messaging',
      from: 'messaging-worker',
      to: 'monolith',
      expectedEpoch: toPilot.ownership.epoch,
      changedBy: 'test-rollback',
      requeueInFlight: true,
    });
    expect(back.ownership.owner).toBe('monolith');
    expect(back.ownership.epoch).toBe(toPilot.ownership.epoch + 1);

    // El piloto sigue vivo y compite: cercado.
    const fenced = await pilot.run({
      tenantId: null,
      limit: 10,
      workerId: 'pilot-late',
      ownership: { context: 'messaging', owner: 'messaging-worker' },
    });
    expect(fenced.fenced).toBe(true);

    // El monolito retoma: procesa lo creado sólo en el piloto; no repite lo ya entregado (processed + inbox).
    const monolith = new OutboxRelayService(sequelize, [], publisher, undefined, undefined, registry);
    const resumed = await monolith.run({
      tenantId: null,
      limit: 10,
      workerId: 'monolith',
      ownership: { context: 'messaging', owner: 'monolith' },
    });
    expect(resumed.fenced).toBe(false);
    expect(resumed.published).toBe(1);
    expect(effects.get(createdOnlyInPilot.eventId)).toBe(1);
    expect(effects.get(delivered.eventId)).toBe(1);
    expect((await OutboxEventModel.findOne({ where: { eventId: delivered.eventId } as never }))?.status).toBe('processed');
    // Una reentrega forzada del ya entregado (p. ej. requeue manual) tampoco duplica el efecto: el inbox la absorbe.
    await OutboxEventModel.update(
      { status: 'pending', ownerToken: null, lockedAt: null, lockedBy: null },
      { where: { eventId: delivered.eventId } as never },
    );
    await monolith.run({ tenantId: null, limit: 10, workerId: 'monolith-2', ownership: { context: 'messaging', owner: 'monolith' } });
    expect(effects.get(delivered.eventId)).toBe(1);
    expect(await InboxReceiptModel.count({ where: { consumerId: CONSUMER, eventId: delivered.eventId } })).toBe(1);
    // Una sola fuente de verdad: el registro dice monolito, y sólo una fila por contexto.
    expect(await registry.current('messaging')).toMatchObject({ owner: 'monolith', epoch: back.ownership.epoch });
  });
});
