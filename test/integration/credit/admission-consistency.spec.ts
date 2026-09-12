/**
 * @file AT-007 — dos decisiones concurrentes sobre el mismo cliente se ORDENAN, no se cruzan.
 * @business Admitir un crédito sobre un estado del cliente que otro proceso está cambiando en ese
 *   mismo instante es admitir sobre una combinación de hechos que nunca existió.
 * @system PostgreSQL real, dos conexiones. La admisión bloquea la fila del cliente (`FOR UPDATE`)
 *   dentro de su transacción; las transiciones de ciclo de vida toman el mismo bloqueo. La barrera
 *   de la prueba es el propio bloqueo, no un `sleep` probabilístico: la segunda transacción no puede
 *   avanzar hasta que la primera confirme, y se comprueba antes y después. La política completa y lo
 *   que el bloqueo NO cubre están en docs/architecture/microservices/admission-consistency.md.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase } from '../support/database.js';
import { buildAdmissionHarness, customerUser, eligibleFacts, type AdmissionHarness } from './support/admission-harness.js';

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
  await harness?.cleanup();
  await database?.close();
});

const body = { productId: '', requestedAmount: 1500, requestedTermMonths: 6 };

/** Promesa que se resuelve desde fuera: el punto exacto en que una transacción queda «a medias». */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Verdadero si la promesa ya terminó (resuelta o rechazada) al momento de preguntar. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  const result = await Promise.race([
    promise.then(
      () => 'done',
      () => 'done',
    ),
    Promise.resolve(marker),
  ]);
  return result !== marker;
}

describe('AT-007 · consistencia de hechos en la admisión', () => {
  it('dos admisiones concurrentes del mismo cliente: una solicitud, la otra recibe el conflicto de negocio', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    const admit = (key: string) =>
      harness!.admission.persistApplication({
        tenantId: harness!.tenantId,
        customerId,
        body: { ...body, productId: harness!.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: key,
      });

    const results = await Promise.allSettled([admit('k-1'), admit('k-2')]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect((rejected[0].reason as Error).message).toBe('CREDIT_APPLICATION_ALREADY_OPEN');
    expect(await harness.countApplications(customerId)).toBe(1);
    // La segunda vio la primera (ya confirmada) al entrar, antes de evaluar: sólo una evidencia.
    expect(await harness.countEvaluations(customerId)).toBe(1);
  });

  it('un bloqueo de cuenta concurrente espera a la admisión en curso y se aplica después, no en medio', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    const barrier = deferred();
    const reachedBarrier = deferred();
    // La admisión se detiene JUSTO después de tomar el bloqueo (loadFacts corre tras findForUpdate).
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockImplementation(async () => {
      reachedBarrier.release();
      await barrier.promise;
      return eligibleFacts();
    });

    const admission = harness.admission.persistApplication({
      tenantId: harness.tenantId,
      customerId,
      body: { ...body, productId: harness.productId },
      currentUser: customerUser(customerId),
      idempotencyKey: `k-${customerId}`,
    });
    await reachedBarrier.promise;

    // Segunda conexión: el analista bloquea la cuenta mientras la admisión está a medias.
    const sequelize = harness.sequelize;
    const block = sequelize.transaction((transaction) =>
      harness!.lifecycleService.transition({
        tenantId: harness!.tenantId,
        customerId,
        toStatus: 'blocked',
        reasonCode: 'fraud_suspected',
        changedByType: 'internal_user',
        changedByInternalUserId: null,
        transaction,
      }),
    );
    // Le damos ocasión de avanzar: no puede, porque la admisión tiene la fila bloqueada.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await settled(block)).toBe(false);

    barrier.release();
    await admission;
    await block;

    const rows = await sequelize.query<{ lifecycle_status: string }>(
      'SELECT lifecycle_status FROM customer.customers WHERE _id = $customerId',
      { type: 'SELECT' as never, bind: { customerId } },
    );
    // Orden autorizado: la solicitud entró con el cliente activo y el bloqueo se aplicó DESPUÉS.
    expect(rows[0]?.lifecycle_status).toBe('blocked');
    expect(await harness.countApplications(customerId)).toBe(1);
    const events = await sequelize.query<{ previous_status: string }>(
      'SELECT previous_status FROM customer.customer_status_events WHERE customer_id = $customerId',
      { type: 'SELECT' as never, bind: { customerId } },
    );
    expect(events.map((event) => event.previous_status)).toEqual(['active']);
  });

  it('el bloqueo llega ANTES: la admisión lee el estado nuevo y deniega sobre hechos consistentes', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    await harness.sequelize.transaction((transaction) =>
      harness!.lifecycleService.transition({
        tenantId: harness!.tenantId,
        customerId,
        toStatus: 'blocked',
        reasonCode: 'fraud_suspected',
        changedByType: 'internal_user',
        changedByInternalUserId: null,
        transaction,
      }),
    );

    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body: { ...body, productId: harness.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      }),
    ).rejects.toThrow(/CUSTOMER_NOT_ELIGIBLE: ACCOUNT_NOT_ACTIVE/);
    expect(await harness.countApplications(customerId)).toBe(0);
  });
});
