import { describe, expect, it, jest } from '@jest/globals';
import { PartnerPortfolioService } from '../../../src/modules/loan-payment-claims/partner-portfolio.service.js';

/**
 * La cartera del comercio: lo que ha cobrado por Atlas y lo que le costó.
 *
 * Es un informe, y por eso lo que se fija son las CIFRAS, no que devuelva algo. Cinco de ellas se
 * equivocan en silencio si el cálculo se invierte: una cuota vencida contada como pendiente, un
 * saldo que suma lo ya pagado, una comisión devengada sobre lo aprobado en vez de sobre lo cobrado,
 * un pago revertido contado como cobro, y un pago que saldó dos cuotas apareciendo con una.
 */

const HOY = '2026-09-09';

function cuota(over: Record<string, unknown> = {}) {
  return {
    id: '1',
    installmentNumber: 1,
    principalAmount: '100.00',
    interestAmount: '0.00',
    lateFeeAmount: '0.00',
    paidPrincipal: '0.00',
    paidInterest: '0.00',
    paidLateFee: '0.00',
    dueDate: '2026-10-01',
    status: 'pending',
    daysPastDue: 0,
    ...over,
  };
}

function montar(
  opciones: {
    cuotas?: Record<string, unknown>[];
    pagos?: Record<string, unknown>[];
    imputaciones?: Record<string, unknown>[];
    mdr?: string;
    pendientesDeVerificar?: number;
  } = {},
) {
  const loans = {
    findLoanByApplication: jest.fn(async () => ({
      id: '5',
      loanCode: 'L-1',
      currencyCode: 'BOB',
      principalAmount: '300.00',
      status: 'active',
    })),
    findInstallments: jest.fn(async () => opciones.cuotas ?? [cuota()]),
    findPaymentsByLoan: jest.fn(async () => opciones.pagos ?? []),
    findAllocationsByPayments: jest.fn(async () => opciones.imputaciones ?? []),
  };
  const credit = { findApplicationsByPartner: jest.fn(async () => [{ id: '77' }]) };
  const partners = { requireProfile: jest.fn(async () => ({ ownerMerchantUserId: 'm1', mdrRatePercent: opciones.mdr ?? '0' })) };
  const claims = { count: jest.fn(async () => opciones.pendientesDeVerificar ?? 0) };

  const service = new PartnerPortfolioService(loans as never, credit as never, partners as never, claims as never);
  return { service, loans, credit, partners, claims };
}

const usuario = { role: 'merchant', merchantUserId: 'm1' } as never;
const pedir = (s: PartnerPortfolioService) => s.portfolioForPartner({ tenantId: '1', partnerProfileId: '7', currentUser: usuario });

describe('PartnerPortfolioService', () => {
  it('separa mora, pendiente y pagado, que son las tres cestas que el comercio mira', async () => {
    jest.useFakeTimers().setSystemTime(new Date(`${HOY}T12:00:00.000Z`));
    const { service } = montar({
      cuotas: [
        cuota({ id: '1', installmentNumber: 1, dueDate: '2026-08-01' }),
        cuota({ id: '2', installmentNumber: 2, dueDate: '2026-12-01' }),
        cuota({ id: '3', installmentNumber: 3, paidPrincipal: '100.00', status: 'paid' }),
      ],
    });

    const cartera = await pedir(service);

    expect(cartera.summary.overdueInstallments).toBe(1);
    expect(cartera.summary.pendingInstallments).toBe(1);
    expect(cartera.summary.paidInstallments).toBe(1);
    // `pendingAmount` es lo que aún no vence: el saldo menos lo que ya está en mora.
    expect(cartera.summary.outstanding).toBe('200.00');
    expect(cartera.summary.overdueAmount).toBe('100.00');
    expect(cartera.summary.pendingAmount).toBe('100.00');
    jest.useRealTimers();
  });

  /*
   * La comisión se DEVENGA sobre lo cobrado, no sobre lo aprobado: un crédito que aún no paga nada
   * no debe comisión. Cobrarla sobre el principal aprobado facturaría de más desde el primer día.
   */
  it('devenga la comisión sobre lo cobrado, no sobre lo aprobado', async () => {
    const { service } = montar({
      mdr: '3.00',
      cuotas: [cuota({ paidPrincipal: '50.00' }), cuota({ id: '2', installmentNumber: 2 })],
    });

    const cartera = await pedir(service);

    expect(cartera.summary.collected).toBe('50.00');
    expect(cartera.summary.mdrRatePercent).toBe('3.00');
    expect(cartera.summary.commissionAccrued).toBe('1.50');
  });

  it('un comercio sin tasa pactada no devenga comisión', async () => {
    const { service } = montar({ cuotas: [cuota({ paidPrincipal: '100.00' })] });

    expect((await pedir(service)).summary.commissionAccrued).toBe('0.00');
  });

  /* Un pago revertido no es un cobro: contarlo inflaría el recuento que el comercio concilia. */
  it('no cuenta como cobro un pago revertido', async () => {
    const { service } = montar({
      pagos: [
        {
          id: 'p1',
          paymentCode: 'PG-1',
          receivedAt: '2026-09-01T10:00:00.000Z',
          amount: '100',
          currencyCode: 'BOB',
          paymentMethod: 'transfer',
          externalReference: null,
          status: 'applied',
        },
        {
          id: 'p2',
          paymentCode: 'PG-2',
          receivedAt: '2026-09-02T10:00:00.000Z',
          amount: '100',
          currencyCode: 'BOB',
          paymentMethod: 'transfer',
          externalReference: null,
          status: 'reversed',
        },
      ],
    });

    const cartera = await pedir(service);

    expect(cartera.summary.paymentsCount).toBe(1);
    expect(cartera.payments.find((p) => p.paymentId === 'p2')?.reversed).toBe(true);
  });

  /* Un pago puede saldar varias cuotas y una cuota recibir varios pagos: la lista no puede perderlo. */
  it('dice qué cuotas cubrió cada pago, sin repetir y en orden', async () => {
    const { service } = montar({
      cuotas: [cuota({ id: '1', installmentNumber: 1 }), cuota({ id: '2', installmentNumber: 2 })],
      pagos: [
        {
          id: 'p1',
          paymentCode: 'PG-1',
          receivedAt: '2026-09-01T10:00:00.000Z',
          amount: '150',
          currencyCode: 'BOB',
          paymentMethod: 'transfer',
          externalReference: null,
          status: 'applied',
        },
      ],
      imputaciones: [
        { loanPaymentId: 'p1', loanInstallmentId: '2', principalApplied: '50', interestApplied: '0', lateFeeApplied: '0' },
        { loanPaymentId: 'p1', loanInstallmentId: '1', principalApplied: '100', interestApplied: '0', lateFeeApplied: '0' },
        { loanPaymentId: 'p1', loanInstallmentId: '1', principalApplied: '0', interestApplied: '0', lateFeeApplied: '0' },
      ],
      mdr: '2.00',
    });

    const cartera = await pedir(service);

    expect(cartera.payments[0].installmentNumbers).toEqual([1, 2]);
    expect(cartera.payments[0].appliedAmount).toBe('150.00');
    expect(cartera.payments[0].commissionAccrued).toBe('3.00');
  });

  it('devuelve los cobros del más reciente al más antiguo', async () => {
    const { service } = montar({
      pagos: [
        {
          id: 'p1',
          paymentCode: 'PG-1',
          receivedAt: '2026-09-01T10:00:00.000Z',
          amount: '10',
          currencyCode: 'BOB',
          paymentMethod: 'transfer',
          externalReference: null,
          status: 'applied',
        },
        {
          id: 'p2',
          paymentCode: 'PG-2',
          receivedAt: '2026-09-05T10:00:00.000Z',
          amount: '10',
          currencyCode: 'BOB',
          paymentMethod: 'transfer',
          externalReference: null,
          status: 'applied',
        },
      ],
    });

    expect((await pedir(service)).payments.map((p) => p.paymentId)).toEqual(['p2', 'p1']);
  });

  /* Una solicitud sin desembolsar no tiene cartera: incluirla contaría un crédito que no existe. */
  it('ignora las solicitudes que todavía no produjeron préstamo', async () => {
    const { service, loans } = montar();
    loans.findLoanByApplication.mockResolvedValueOnce(null as never);

    const cartera = await pedir(service);

    expect(cartera.summary.totalCredits).toBe(0);
    expect(cartera.credits).toEqual([]);
  });

  it('cuenta los comprobantes que esperan su confirmación', async () => {
    const { service } = montar({ pendientesDeVerificar: 3 });

    expect((await pedir(service)).summary.proofsAwaitingVerification).toBe(3);
  });

  /* La cartera es del comercio: otro no puede pedirla aunque conozca el identificador. */
  it('rechaza a quien no es el dueño del expediente', async () => {
    const { service } = montar();

    await expect(
      service.portfolioForPartner({
        tenantId: '1',
        partnerProfileId: '7',
        currentUser: { role: 'merchant', merchantUserId: 'otro' } as never,
      }),
    ).rejects.toBeDefined();
  });
});
