/**
 * @file ATL-09 — el reverso de un cobro contra PostgreSQL real: el evento cuenta el estado de verdad.
 * @business Reversar el único cobro de un préstamo ya cancelado lo reabre. El libro de eventos es la
 *   auditoría de esa reapertura: tiene que decir `paid_off → active`, no `active → active`.
 * @system Servicios reales del libro sobre la base de integración. La atomicidad se mide haciendo
 *   fallar la escritura del evento: si el reverso y su evento no viajan en la misma transacción,
 *   el cobro quedaría reversado sin rastro.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase } from '../support/database.js';
import { buildLoanBookHarness, internalOperator, type LoanBookHarness } from './support/loan-book-harness.js';

let database: IntegrationDatabase | null = null;
let harness: LoanBookHarness | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) harness = await buildLoanBookHarness(database.sequelize);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness?.cleanup();
  await database?.close();
});

const PARTNER = '910101';

/** Un préstamo de 1.000 saldado de una vez: queda `paid_off` con un solo cobro. */
async function paidOffLoan(h: LoanBookHarness) {
  const loan = await h.createLoan(PARTNER);
  const payment = await h.payments.registerPayment({
    tenantId: h.tenantId,
    loanId: loan.loanId,
    body: { amount: '1000.00', currencyCode: 'BOB', paymentMethod: 'transfer' } as never,
    currentUser: internalOperator,
    idempotencyKey: `total-${loan.loanId}`,
  });
  return { ...loan, paymentId: String(payment.paymentId) };
}

async function loanState(h: LoanBookHarness, loanId: string) {
  const rows = await h.query<{ status: string; outstanding_principal: string }>(
    'SELECT status, outstanding_principal::text FROM credit.loans WHERE _tenant_id = $tenantId AND _id = $loanId',
    { loanId },
  );
  return rows[0]!;
}

async function reversalEvents(h: LoanBookHarness, loanId: string) {
  return h.query<{ previous_status: string | null; new_status: string | null }>(
    `SELECT previous_status, new_status FROM credit.loan_events
      WHERE _tenant_id = $tenantId AND loan_id = $loanId AND event_type = 'payment_reversed' ORDER BY _id`,
    { loanId },
  );
}

async function paymentStatus(h: LoanBookHarness, paymentId: string) {
  const rows = await h.query<{ status: string }>('SELECT status FROM credit.loan_payments WHERE _tenant_id = $tenantId AND _id = $id', {
    id: paymentId,
  });
  return rows[0]!.status;
}

function reverse(h: LoanBookHarness, loanId: string, paymentId: string) {
  return h.payments.reversePayment({
    tenantId: h.tenantId,
    loanId,
    paymentId,
    body: { reasonCode: 'chargeback' } as never,
    currentUser: internalOperator,
  });
}

describe('ATL-09 · reverso de cobro (PostgreSQL real)', () => {
  it('reversar el único cobro de un préstamo cancelado lo reabre y el evento registra paid_off → active', async () => {
    if (!harness) return;
    const loan = await paidOffLoan(harness);
    expect((await loanState(harness, loan.loanId)).status).toBe('paid_off');

    const result = await reverse(harness, loan.loanId, loan.paymentId);

    expect(result).toMatchObject({ status: 'reversed', loanStatus: 'active' });
    expect(await loanState(harness, loan.loanId)).toEqual({ status: 'active', outstanding_principal: '1000.00' });
    expect(await reversalEvents(harness, loan.loanId)).toEqual([{ previous_status: 'paid_off', new_status: 'active' }]);
  });

  it('si la escritura del evento falla, nada cambia: el cobro sigue aplicado y el préstamo cancelado', async () => {
    if (!harness) return;
    const loan = await paidOffLoan(harness);
    jest.spyOn(harness.loansRepository, 'createEvent').mockRejectedValueOnce(new Error('caída al escribir el evento'));

    await expect(reverse(harness, loan.loanId, loan.paymentId)).rejects.toThrow('caída al escribir el evento');

    expect(await paymentStatus(harness, loan.paymentId)).toBe('applied');
    expect((await loanState(harness, loan.loanId)).status).toBe('paid_off');
    expect(await reversalEvents(harness, loan.loanId)).toEqual([]);
  });
});
