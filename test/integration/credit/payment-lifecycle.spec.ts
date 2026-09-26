/**
 * @file P-08 — el circuito del aviso de pago contra PostgreSQL real: reportar, confirmar, repetir, fallar.
 * @business Reportar no salda; sólo el comercio de ESA compra confirma; confirmar dos veces cobra una;
 *   y el pago, la cuota y el evento se confirman juntos o no se confirma ninguno.
 * @system Servicios reales del libro, de los avisos y del outbox sobre la base de integración. La
 *   atomicidad se mide provocando el fallo DESPUÉS de que el evento se escribió: si el evento viajaba
 *   por otra conexión (autocommit), sobrevive al rollback y la prueba lo delata.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase } from '../support/database.js';
import { buildLoanBookHarness, customerUser, merchantOf, type LoanBookHarness } from './support/loan-book-harness.js';

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

const PARTNER_A = '910001';
const PARTNER_B = '910002';

type Loan = Awaited<ReturnType<LoanBookHarness['createLoan']>>;

async function report(h: LoanBookHarness, loan: Loan, installmentIndex = 0, amount = '333.33') {
  return h.claims.submit({
    tenantId: h.tenantId,
    customerId: loan.customerId,
    body: {
      installmentId: String(loan.installments[installmentIndex]!.id),
      amount,
      contentType: 'image/jpeg',
      storageKey: `files/${h.tenantId}/${loan.customerId}/payment_proof/${Date.now()}.jpg`,
      sizeBytes: 1024,
    } as never,
    currentUser: customerUser(loan.customerId),
  });
}

function confirm(h: LoanBookHarness, claimId: string, partnerId = PARTNER_A, verified = true) {
  return h.partnerClaims.decide({
    tenantId: h.tenantId,
    partnerProfileId: partnerId,
    claimId,
    body: verified ? { verified: true } : { verified: false, reason: 'No veo la transferencia' },
    currentUser: merchantOf(partnerId),
  });
}

async function installmentState(h: LoanBookHarness, installmentId: string) {
  const rows = await h.query<{ status: string; paid_principal: string }>(
    'SELECT status, paid_principal::text FROM credit.loan_installments WHERE _tenant_id = $tenantId AND _id = $id',
    { id: installmentId },
  );
  return rows[0]!;
}

async function paymentsOf(h: LoanBookHarness, loanId: string): Promise<number> {
  const rows = await h.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM credit.loan_payments WHERE _tenant_id = $tenantId AND loan_id = $loanId',
    { loanId },
  );
  return Number(rows[0]!.n);
}

async function eventsOf(h: LoanBookHarness, installmentId: string) {
  return h.query<{ event_code: string; aggregate_version: string | null }>(
    `SELECT event_code, aggregate_version::text FROM platform_ops.outbox_events
      WHERE _tenant_id = $tenantId AND aggregate_type = 'installment' AND aggregate_id = $id ORDER BY _id`,
    { id: installmentId },
  );
}

async function claimRows(h: LoanBookHarness, installmentId: string) {
  return h.query<{ status: string }>(
    'SELECT status FROM credit.loan_payment_claims WHERE _tenant_id = $tenantId AND installment_id = $id',
    {
      id: installmentId,
    },
  );
}

describe('P-08 · circuito del aviso de pago (PostgreSQL real)', () => {
  it('reportar el pago NO salda la cuota: queda pendiente de verificación y con saldo', async () => {
    if (!harness) return;
    const loan = await harness.createLoan(PARTNER_A);
    const installmentId = String(loan.installments[0]!.id);

    const claim = await report(harness, loan);

    expect(claim.status).toBe('pending_verification');
    expect(await installmentState(harness, installmentId)).toEqual({ status: 'pending', paid_principal: '0.00' });
    expect(await paymentsOf(harness, loan.loanId)).toBe(0);
    expect(await eventsOf(harness, installmentId)).toEqual([{ event_code: 'payment.reported', aggregate_version: '1' }]);
  });

  it('el aviso y su evento son atómicos: si la transacción cae después de escribir el evento, no queda ni aviso ni evento', async () => {
    if (!harness) return;
    const loan = await harness.createLoan(PARTNER_A);
    const installmentId = String(loan.installments[0]!.id);
    const publish = harness.events.publish.bind(harness.events);
    jest.spyOn(harness.events, 'publish').mockImplementation(async (...args) => {
      await publish(...args);
      throw new Error('caída después de escribir el evento');
    });

    await expect(report(harness, loan)).rejects.toThrow('caída después de escribir el evento');

    expect(await claimRows(harness, installmentId)).toEqual([]);
    expect(await eventsOf(harness, installmentId)).toEqual([]);
  });

  it('el comercio autorizado confirma: la cuota se salda una vez y el evento lleva la versión siguiente', async () => {
    if (!harness) return;
    const loan = await harness.createLoan(PARTNER_A);
    const installmentId = String(loan.installments[0]!.id);
    const claim = await report(harness, loan);

    const decided = await confirm(harness, claim.claimId);

    expect(decided.status).toBe('verified');
    expect(await installmentState(harness, installmentId)).toEqual({ status: 'paid', paid_principal: '333.33' });
    expect(await paymentsOf(harness, loan.loanId)).toBe(1);
    expect(await eventsOf(harness, installmentId)).toEqual([
      { event_code: 'payment.reported', aggregate_version: '1' },
      { event_code: 'payment.confirmed', aggregate_version: '2' },
    ]);
  });

  it('dos confirmaciones simultáneas cobran UNA vez: la segunda recibe PAYMENT_CLAIM_NOT_PENDING', async () => {
    if (!harness) return;
    const loan = await harness.createLoan(PARTNER_A);
    const installmentId = String(loan.installments[0]!.id);
    const claim = await report(harness, loan);

    const results = await Promise.allSettled([confirm(harness, claim.claimId), confirm(harness, claim.claimId)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictException);
    expect((rejected[0]!.reason as Error).message).toBe('PAYMENT_CLAIM_NOT_PENDING');
    expect(await paymentsOf(harness, loan.loanId)).toBe(1);
    expect(await installmentState(harness, installmentId)).toEqual({ status: 'paid', paid_principal: '333.33' });
  });

  it('la confirmación es atómica: si cae después del evento no queda cobro, la cuota sigue abierta y el aviso pendiente', async () => {
    if (!harness) return;
    const loan = await harness.createLoan(PARTNER_A);
    const installmentId = String(loan.installments[0]!.id);
    const claim = await report(harness, loan);
    const publish = harness.events.publish.bind(harness.events);
    jest.spyOn(harness.events, 'publish').mockImplementation(async (...args) => {
      await publish(...args);
      throw new Error('caída después de escribir la confirmación');
    });

    await expect(confirm(harness, claim.claimId)).rejects.toThrow('caída después de escribir la confirmación');

    expect(await paymentsOf(harness, loan.loanId)).toBe(0);
    expect(await installmentState(harness, installmentId)).toEqual({ status: 'pending', paid_principal: '0.00' });
    expect(await claimRows(harness, installmentId)).toEqual([{ status: 'pending_verification' }]);
    expect((await eventsOf(harness, installmentId)).map((event) => event.event_code)).toEqual(['payment.reported']);
  });

  it('el comercio B no confirma sobre el préstamo del comercio A, y el cliente no puede autoconfirmar', async () => {
    if (!harness) return;
    const loan = await harness.createLoan(PARTNER_A);
    const claim = await report(harness, loan);

    await expect(confirm(harness, claim.claimId, PARTNER_B)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      harness.partnerClaims.decide({
        tenantId: harness.tenantId,
        partnerProfileId: PARTNER_A,
        claimId: claim.claimId,
        body: { verified: true },
        currentUser: customerUser(loan.customerId),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(await paymentsOf(harness, loan.loanId)).toBe(0);
    expect(await claimRows(harness, String(loan.installments[0]!.id))).toEqual([{ status: 'pending_verification' }]);
  });

  it('duplicados y desorden no reabren una cuota pagada: rechazar tras confirmar y reportar sobre pagada dan 409', async () => {
    if (!harness) return;
    const loan = await harness.createLoan(PARTNER_A);
    const installmentId = String(loan.installments[0]!.id);
    const claim = await report(harness, loan);
    await confirm(harness, claim.claimId);

    await expect(confirm(harness, claim.claimId, PARTNER_A, false)).rejects.toThrow('PAYMENT_CLAIM_NOT_PENDING');
    await expect(report(harness, loan)).rejects.toThrow('INSTALLMENT_ALREADY_PAID');

    expect(await installmentState(harness, installmentId)).toEqual({ status: 'paid', paid_principal: '333.33' });
    expect(await paymentsOf(harness, loan.loanId)).toBe(1);
  });

  it('un aviso cuya cuota ya saldó otro cobro no se aplica otra vez: 409 INSTALLMENT_ALREADY_PAID sin cobro nuevo', async () => {
    if (!harness) return;
    const loan = await harness.createLoan(PARTNER_A);
    const installmentId = String(loan.installments[0]!.id);
    const claim = await report(harness, loan);
    // Otro camino (cobro en caja, cobertura conciliada) salda la cuota mientras el aviso espera.
    await harness.payments.registerPayment({
      tenantId: harness.tenantId,
      loanId: loan.loanId,
      body: { amount: '333.33', currencyCode: 'BOB', paymentMethod: 'cash' } as never,
      currentUser: merchantOf(PARTNER_A),
      idempotencyKey: `caja-${installmentId}`,
    });

    await expect(confirm(harness, claim.claimId)).rejects.toThrow('INSTALLMENT_ALREADY_PAID');

    expect(await paymentsOf(harness, loan.loanId)).toBe(1);
    expect(await claimRows(harness, installmentId)).toEqual([{ status: 'pending_verification' }]);
  });
});
