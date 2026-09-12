/**
 * @file AT-054 — matriz de fallos parciales del relay: transporte lento, consumidor caído, relay muerto,
 *   base caída. Con tiempos MEDIDOS que se registran en el protocolo, no estimados.
 * @business Un proveedor lento no debe retener conexiones de la base ni bloquear a otros relays; un
 *   consumidor caído no pierde la intención; un relay que muere a medias deja el trabajo recuperable
 *   por otro cuando vence el lease; sin base, el relay falla explícitamente, no «procesa cero».
 * @system PostgreSQL real; publicadores de prueba con latencia y fallos controlados; el segundo relay
 *   se mide con `performance.now()` mientras el primero sigue publicando.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { performance } from 'node:perf_hooks';
import { Sequelize } from 'sequelize-typescript';
import { OutboxEventModel } from '../../../src/database/models/index.js';
import { EventsRepository } from '../../../src/modules/events/events.repository.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../../src/platform/events/event-consumer.port.js';
import type { EventPublisher } from '../../../src/platform/events/event-publisher.port.js';
import { LocalConsumerDispatchPublisher, OUTBOX_LEASE_MS, OutboxRelayService } from '../../../src/platform/events/outbox-relay.service.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const producer = `it-resilience-${runToken()}`;

beforeAll(async () => {
  database = await openIntegrationDatabase();
});
afterAll(async () => {
  if (database) await OutboxEventModel.destroy({ where: { producer } });
  await database?.close();
});

async function seed(count: number, aggregatePrefix: string): Promise<string[]> {
  const now = new Date();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = await OutboxEventModel.create({
      tenantId: null,
      aggregateType: 'credit_application',
      aggregateId: `${aggregatePrefix}-${index}`,
      aggregateVersion: 1,
      eventCode: 'credit.application.submitted',
      eventPayloadJson: { index },
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
    ids.push(row.eventId);
  }
  return ids;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('AT-054 · matriz de fallos parciales', () => {
  it('transporte lento: no retiene la base; otro relay reclama y publica mientras el lento sigue (medido)', async () => {
    if (!database) return;
    await seed(3, 'slow');
    const slow: EventPublisher = { publish: async () => (await sleep(150), { accepted: true, transport: 'slow' }) };
    const fast: EventPublisher = { publish: async () => ({ accepted: true, transport: 'fast' }) };
    const slowRun = new OutboxRelayService(database.sequelize, [], slow).run({ tenantId: null, limit: 3, workerId: 'slow' });
    await sleep(30); // el lento ya reclamó sus 3 filas y está publicando la primera
    await seed(3, 'fast');
    const started = performance.now();
    const fastResult = await new OutboxRelayService(database.sequelize, [], fast).run({ tenantId: null, limit: 3, workerId: 'fast' });
    const elapsedMs = performance.now() - started;
    const slowResult = await slowRun;
    expect(fastResult.published).toBe(3);
    expect(slowResult.published).toBe(3);
    // 3 publicaciones lentas = 450 ms; el rápido termina mucho antes: el reclamo no espera al lento.
    expect(elapsedMs).toBeLessThan(400);
    // eslint-disable-next-line no-console
    console.info(`[AT-054] relay rápido con relay lento en curso: ${elapsedMs.toFixed(0)} ms para 3 eventos`);
  });

  it('consumidor caído: el productor conserva la intención (pending con reintento) y al volver se entrega una vez', async () => {
    if (!database) return;
    const [eventId] = await seed(1, 'down');
    let alive = false;
    const handled: string[] = [];
    const consumer: EventConsumer = {
      consumerId: 'resilience.consumer',
      subscriptions: { 'credit.application.submitted': [1] },
      async handle(event) {
        if (!alive) throw new Error('consumidor caído');
        handled.push(event.eventId);
      },
    };
    const relay = new OutboxRelayService(
      database.sequelize,
      [],
      new LocalConsumerDispatchPublisher(database.sequelize, new ConsumerRegistry([consumer])),
    );
    const down = await relay.run({ tenantId: null, limit: 1, workerId: 'r1' });
    expect(down.retried).toBe(1);
    const parked = await OutboxEventModel.findOne({ where: { eventId } as never });
    expect(parked?.status).toBe('pending');
    expect(parked!.availableAt!.getTime()).toBeGreaterThan(Date.now());
    alive = true;
    // Vence la espera de reintento: se pasa un «ahora» futuro.
    const later = new Date(parked!.availableAt!.getTime() + 1000);
    const recovered = await relay.run({ tenantId: null, limit: 1, workerId: 'r2', now: later });
    expect(recovered.published).toBe(1);
    expect(handled).toEqual([eventId]);
  });

  it('relay muerto a medias: el reaper (`reclaim_stuck_events`) devuelve la fila y otro relay la publica; el testigo viejo no cierra nada', async () => {
    if (!database) return;
    const [eventId] = await seed(1, 'dead');
    const publisher: EventPublisher = { publish: async () => ({ accepted: true, transport: 'test' }) };
    const dead = new OutboxRelayService(database.sequelize, [], publisher);
    const { ownerToken: deadToken, rows } = await dead.claim({ tenantId: null, limit: 1, workerId: 'dead' });
    expect(rows).toHaveLength(1);
    // El relay v2 sólo reclama `pending`: mientras el lease no venza, nadie se lleva la fila.
    const early = await new OutboxRelayService(database.sequelize, [], publisher).run({ tenantId: null, limit: 1, workerId: 'early' });
    expect(early.claimed).toBe(0);
    // Vence el lease: el job existente `reclaim_stuck_events` (v1, mismo camino en producción) la devuelve a pending
    // y anula el testigo; otro relay la publica.
    const reaper = new EventsRepository(OutboxEventModel, database.sequelize);
    const afterLease = new Date(Date.now() + OUTBOX_LEASE_MS + 1000);
    const reclaimed = await reaper.reclaimStuckProcessing({ olderThan: afterLease, limit: 10 });
    expect(reclaimed.eventIds).toContain(String(rows[0].id));
    expect((await OutboxEventModel.findOne({ where: { eventId } as never }))?.ownerToken).toBeNull();
    expect(await dead.complete(rows[0], deadToken, { status: 'failed' })).toBe(false);
    const recovered = await new OutboxRelayService(database.sequelize, [], publisher).run({ tenantId: null, limit: 1, workerId: 'heir' });
    expect(recovered.published).toBe(1);
    expect((await OutboxEventModel.findOne({ where: { eventId } as never }))?.status).toBe('processed');
  });

  it('base caída: el relay falla con error explícito; no reporta «0 procesados»', async () => {
    const unreachable = new Sequelize({
      dialect: 'postgres',
      host: '127.0.0.1',
      port: 1,
      database: 'x',
      username: 'x',
      password: 'x',
      logging: false,
      models: [],
    });
    const relay = new OutboxRelayService(unreachable, [], { publish: async () => ({ accepted: true, transport: 'test' }) });
    await expect(relay.run({ tenantId: null, limit: 1, workerId: 'nodb' })).rejects.toBeDefined();
    await unreachable.close();
  });
});
