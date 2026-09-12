/**
 * @file AT-033 — el evento de dominio se confirma con el agregado o no se confirma.
 * @business Si la solicitud existe, su evento `credit.application.submitted` existe; si el evento no puede
 *   escribirse, la solicitud no se confirma; tras el commit, el evento queda durable y pendiente.
 * @system PostgreSQL real con la unidad de trabajo de Crédito y el caso de uso de solicitud.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { OutboxEventModel } from '../../../src/database/models/index.js';
import { buildAdmissionHarness, customerUser, eligibleFacts, type AdmissionHarness } from '../credit/support/admission-harness.js';
import { openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let harness: AdmissionHarness | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) harness = await buildAdmissionHarness(database.sequelize);
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(async () => {
  if (database && harness)
    await database.sequelize.query('DELETE FROM platform_ops.outbox_events WHERE _tenant_id = $tenantId', {
      bind: { tenantId: harness.tenantId },
    });
  await harness?.cleanup();
  await database?.close();
});

const body = { productId: '', requestedAmount: 1500, requestedTermMonths: 6 };

async function domainEvents(harness: AdmissionHarness, customerId: string) {
  return harness.sequelize.query<{ event_code: string; status: string; aggregate_id: string; producer: string; event_id: string }>(
    `SELECT event_code, status, aggregate_id, producer, event_id FROM platform_ops.outbox_events o
     WHERE o._tenant_id = $tenantId AND o.event_code = 'credit.application.submitted'
       AND o.aggregate_id IN (SELECT _id::text FROM credit.credit_applications WHERE customer_id = $customerId)`,
    { type: QueryTypes.SELECT, bind: { tenantId: harness.tenantId, customerId } },
  );
}

describe('AT-033 · outbox con el agregado', () => {
  it('solicitud admitida: queda UN evento pendiente, durable, con el agregado y el productor', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    await harness.admission.persistApplication({
      tenantId: harness.tenantId,
      customerId,
      body: { ...body, productId: harness.productId },
      currentUser: customerUser(customerId),
      idempotencyKey: `k-${customerId}`,
    });
    const events = await domainEvents(harness, customerId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'pending', producer: 'credit' });
    expect(events[0].event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falla la inserción del evento: la solicitud NO se confirma', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    jest.spyOn(OutboxEventModel, 'create').mockRejectedValue(new Error('fallo simulado del outbox') as never);
    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body: { ...body, productId: harness.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      }),
    ).rejects.toThrow('fallo simulado del outbox');
    expect(await harness.countApplications(customerId)).toBe(0);
  });

  it('falla el agregado: no queda evento publicable', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    jest.spyOn(harness.creditRepository, 'createApplicationEvent').mockRejectedValue(new Error('fallo simulado del agregado'));
    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body: { ...body, productId: harness.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      }),
    ).rejects.toThrow('fallo simulado del agregado');
    expect(await domainEvents(harness, customerId)).toHaveLength(0);
  });

  it('denegación: evidencia confirmada, ninguna solicitud y ningún evento de solicitud presentada', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('under_review');
    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body: { ...body, productId: harness.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      }),
    ).rejects.toThrow(/CUSTOMER_NOT_ELIGIBLE/);
    expect(await harness.countEvaluations(customerId)).toBe(1);
    expect(await domainEvents(harness, customerId)).toHaveLength(0);
  });
});
