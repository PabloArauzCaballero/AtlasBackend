/**
 * @file AT-052 — recorrido crítico contra PostgreSQL: cliente → elegibilidad → solicitud → evento → consumidor.
 * @business Un recorrido permitido deja evidencia en cada dueño (evaluación en Clientes, solicitud y
 *   evento en Crédito, recibo en el consumidor); un replay deja UNA solicitud y UNA entrega lógica; un
 *   cliente bloqueado a mitad del recorrido se detiene con evidencia y sin solicitud.
 * @system Fachada real de admisión (`persistApplication`), relay v2 real y un consumidor de prueba con
 *   inbox; los hechos de elegibilidad se fijan con `loadFacts` para que el recorrido sea reproducible.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../../src/platform/events/event-consumer.port.js';
import { LocalConsumerDispatchPublisher, OutboxRelayService } from '../../../src/platform/events/outbox-relay.service.js';
import { buildAdmissionHarness, customerUser, eligibleFacts, type AdmissionHarness } from '../credit/support/admission-harness.js';
import { openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let harness: AdmissionHarness | null = null;
const CONSUMER = 'journey.consumer';
const handled: string[] = [];

const consumer: EventConsumer = {
  consumerId: CONSUMER,
  subscriptions: { 'credit.application.submitted': [1] },
  async handle(event) {
    handled.push(`${event.eventId}:${String(event.payload.applicationCode)}`);
  },
};

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) harness = await buildAdmissionHarness(database.sequelize);
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(async () => {
  if (database) await InboxReceiptModel.destroy({ where: { consumerId: CONSUMER } });
  await harness?.cleanup();
  await database?.close();
});

const body = { requestedAmount: 1500, requestedTermMonths: 6 };

function submit(customerId: string, key: string) {
  return harness!.admission.persistApplication({
    tenantId: harness!.tenantId,
    customerId,
    body: { ...body, productId: harness!.productId },
    currentUser: customerUser(customerId),
    idempotencyKey: key,
  });
}

describe('AT-052 · recorrido crítico contra la base', () => {
  it('camino permitido: evidencia en cada dueño y una entrega lógica al consumidor; el replay no duplica nada', async () => {
    if (!harness || !database) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());

    const created = await submit(customerId, `journey-${customerId}`);
    expect(created.status).toBe('submitted');
    expect(created.requestedAmount).toBe('1500.00');
    expect(await harness.countEvaluations(customerId)).toBe(1);
    expect(await harness.countApplications(customerId)).toBe(1);
    const events = await OutboxEventModel.findAll({ where: { tenantId: harness.tenantId, eventCode: 'credit.application.submitted' } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('pending');
    expect(events[0].producer).toBe('credit');

    // Entrega por el relay v2 con inbox: una vez.
    const relay = new OutboxRelayService(
      database.sequelize,
      [],
      new LocalConsumerDispatchPublisher(database.sequelize, new ConsumerRegistry([consumer])),
    );
    const first = await relay.run({ tenantId: harness.tenantId, limit: 10, workerId: 'journey' });
    expect(first.published).toBe(1);
    expect(handled.filter((entry) => entry.endsWith(`:${created.applicationCode}`))).toHaveLength(1);
    expect(await InboxReceiptModel.count({ where: { consumerId: CONSUMER, eventId: events[0].eventId } })).toBe(1);

    // Replay de la solicitud (misma clave): el dueño responde con el conflicto de negocio y no escribe nada nuevo.
    await expect(submit(customerId, `journey-${customerId}`)).rejects.toBeInstanceOf(ConflictException);
    expect(await harness.countApplications(customerId)).toBe(1);
    expect(await OutboxEventModel.count({ where: { tenantId: harness.tenantId, eventCode: 'credit.application.submitted' } })).toBe(1);
    // Replay del evento (relay de nuevo): nada pendiente, ninguna entrega nueva.
    const second = await relay.run({ tenantId: harness.tenantId, limit: 10, workerId: 'journey-2' });
    expect(second.claimed).toBe(0);
    expect(handled.filter((entry) => entry.endsWith(`:${created.applicationCode}`))).toHaveLength(1);
  });

  it('bloqueo a mitad del recorrido: un cliente bloqueado recibe la denegación con evidencia y sin solicitud', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('blocked');
    // Los hechos son «buenos»: lo que bloquea es el estado del cliente, que el dueño lee de su fila bloqueada (AT-007).
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    await expect(submit(customerId, `blocked-${customerId}`)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(await harness.countEvaluations(customerId)).toBe(1);
    expect(await harness.countApplications(customerId)).toBe(0);
  });
});
