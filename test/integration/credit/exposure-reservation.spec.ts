/**
 * @file P-11 (B15) — el cupo de la línea contra concesiones concurrentes, en PostgreSQL real.
 * @business Exposición 900, límite 1.000 y dos solicitudes de 80 a la vez: como mucho una se concede.
 *   Una decisión vencida no concede; cancelar devuelve el cupo una sola vez.
 * @system Desembolso y reserva reales sobre la base de integración. La barrera es el cerrojo de la
 *   fila del cliente: la segunda transacción no puede leer la exposición hasta que la primera confirma.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase } from '../support/database.js';
import { buildLoanBookHarness, type LoanBookHarness } from './support/loan-book-harness.js';

let database: IntegrationDatabase | null = null;
let harness: LoanBookHarness | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) harness = await buildLoanBookHarness(database.sequelize);
});

afterAll(async () => {
  await harness?.cleanup();
  await database?.close();
});

/** Un cliente con línea de 1.000 que ya debe 900 de capital. */
async function customerWithExposure900(h: LoanBookHarness): Promise<string> {
  const customerId = await h.createCustomer();
  await h.createCreditLine(customerId, '1000.00');
  const first = await h.createApprovedApplication({ customerId, amount: '900.00' });
  await h.disburse(first);
  return customerId;
}

async function loansOf(h: LoanBookHarness, customerId: string): Promise<number> {
  const rows = await h.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM credit.loans WHERE _tenant_id = $tenantId AND customer_id = $customerId',
    { customerId },
  );
  return Number(rows[0]!.n);
}

async function reservationsOf(h: LoanBookHarness, customerId: string) {
  return h.query<{ status: string; amount: string }>(
    `SELECT status, amount::text FROM credit.credit_exposure_reservations
      WHERE _tenant_id = $tenantId AND customer_id = $customerId ORDER BY _id`,
    { customerId },
  );
}

describe('P-11 · reserva de exposición (PostgreSQL real)', () => {
  it('exposición 900, límite 1.000, dos desembolsos concurrentes de 80: exactamente uno se concede', async () => {
    if (!harness) return;
    const customerId = await customerWithExposure900(harness);
    const a = await harness.createApprovedApplication({ customerId, amount: '80.00' });
    const b = await harness.createApprovedApplication({ customerId, amount: '80.00' });

    const results = await Promise.allSettled([harness.disburse(a), harness.disburse(b)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictException);
    expect((rejected[0]!.reason as Error).message).toBe('CREDIT_EXPOSURE_LIMIT_EXCEEDED');
    expect(await loansOf(harness, customerId)).toBe(2);
    expect((await reservationsOf(harness, customerId)).map((row) => row.status)).toEqual(['consumed', 'consumed']);
  });

  it('dos aceptaciones concurrentes que juntas exceden el límite: sólo una reserva el cupo', async () => {
    if (!harness) return;
    const customerId = await customerWithExposure900(harness);
    const a = await harness.createApprovedApplication({ customerId, amount: '80.00', businessAcceptance: 'pending' });
    const b = await harness.createApprovedApplication({ customerId, amount: '80.00', businessAcceptance: 'pending' });
    const reserve = (applicationId: string) =>
      harness!.sequelize.transaction((transaction) =>
        harness!.exposure.reserve(
          {
            tenantId: harness!.tenantId,
            customerId,
            applicationId,
            amount: '80.00',
            currencyCode: 'BOB',
            expiresAt: new Date(Date.now() + 3_600_000),
            now: new Date(),
          },
          transaction,
        ),
      );

    const results = await Promise.allSettled([reserve(a), reserve(b)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await reservationsOf(harness, customerId)).toEqual([
      { status: 'consumed', amount: '900.00' },
      { status: 'reserved', amount: '80.00' },
    ]);
  });

  it('una solicitud que cabe sola se concede y consume su reserva', async () => {
    if (!harness) return;
    const customerId = await customerWithExposure900(harness);
    const app = await harness.createApprovedApplication({ customerId, amount: '100.00' });

    await expect(harness.disburse(app)).resolves.toEqual(expect.objectContaining({ status: 'active' }));
    expect((await reservationsOf(harness, customerId)).at(-1)).toEqual({ status: 'consumed', amount: '100.00' });
  });

  it('sin línea vigente no se concede: CREDIT_LIMIT_UNKNOWN (un límite desconocido no es infinito)', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer();
    const app = await harness.createApprovedApplication({ customerId, amount: '50.00' });

    await expect(harness.disburse(app)).rejects.toThrow('CREDIT_LIMIT_UNKNOWN');
    expect(await loansOf(harness, customerId)).toBe(0);
  });

  it('una decisión vencida no concede y su reserva vencida no cuenta contra el cupo', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer();
    await harness.createCreditLine(customerId, '100.00');
    const stale = await harness.createApprovedApplication({
      customerId,
      amount: '100.00',
      decidedAt: new Date(Date.now() - 200 * 3_600_000),
    });
    // Una reserva vieja de esa solicitud, ya vencida, que no debe bloquear a la vigente.
    await harness.sequelize.query(
      `INSERT INTO credit.credit_exposure_reservations
         (_tenant_id, customer_id, credit_application_id, amount, currency_code, status, expires_at, reserved_at, _created_at)
       VALUES ($tenantId, $customerId, $applicationId, 100.00, 'BOB', 'reserved', now() - interval '1 hour', now() - interval '2 days', now())`,
      { bind: { tenantId: harness.tenantId, customerId, applicationId: stale } },
    );

    await expect(harness.disburse(stale)).rejects.toThrow('CREDIT_DECISION_EXPIRED');
    const fresh = await harness.createApprovedApplication({ customerId, amount: '100.00' });
    await expect(harness.disburse(fresh)).resolves.toEqual(expect.objectContaining({ status: 'active' }));
  });

  it('cancelar libera la reserva UNA sola vez aunque lleguen dos cancelaciones a la vez', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer();
    await harness.createCreditLine(customerId, '100.00');
    const app = await harness.createApprovedApplication({ customerId, amount: '100.00', businessAcceptance: 'pending' });
    await harness.sequelize.transaction((transaction) =>
      harness!.exposure.reserve(
        {
          tenantId: harness!.tenantId,
          customerId,
          applicationId: app,
          amount: '100.00',
          currencyCode: 'BOB',
          expiresAt: new Date(Date.now() + 3_600_000),
          now: new Date(),
        },
        transaction,
      ),
    );
    const release = () =>
      harness!.exposure.release({ tenantId: harness!.tenantId, applicationId: app, reason: 'cancelled', now: new Date() });

    const [first, second] = await Promise.all([release(), release()]);

    expect([first.released, second.released].sort()).toEqual([false, true]);
    expect(await reservationsOf(harness, customerId)).toEqual([{ status: 'released', amount: '100.00' }]);
    // El cupo liberado vuelve a estar disponible para otra solicitud.
    const other = await harness.createApprovedApplication({ customerId, amount: '100.00' });
    await expect(harness.disburse(other)).resolves.toEqual(expect.objectContaining({ status: 'active' }));
  });

  it('reintentar el mismo desembolso no aparta el cupo dos veces', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer();
    await harness.createCreditLine(customerId, '100.00');
    const app = await harness.createApprovedApplication({ customerId, amount: '100.00' });

    const first = await harness.disburse(app, 'misma-clave');
    const retry = await harness.disburse(app, 'misma-clave');

    expect(retry).toEqual(first);
    expect(await reservationsOf(harness, customerId)).toEqual([{ status: 'consumed', amount: '100.00' }]);
  });
});
