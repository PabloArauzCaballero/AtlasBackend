import { writeFileSync } from 'node:fs';
import { CreditStatementService, cuentasDelExtracto } from '../../../src/modules/loans/application/credit-statement.service';

/** Pablo (2026-10-08): el extracto de crédito se tiene que poder descargar en PDF, y no «básico». */
const credito = {
  loanId: '1',
  loanCode: 'LOAN-1',
  principalAmount: '480.00',
  termMonths: 2,
  disbursedAt: new Date('2026-10-08T12:53:07Z'),
  merchant: { partnerProfileId: '2', displayName: 'Multicenter', businessCategory: 'electronica' },
  payments: [
    { paymentId: 'p1', amount: '240.00', receivedAt: new Date('2026-11-07T10:00:00Z'), status: 'posted' },
    { paymentId: 'p2', amount: '99.00', receivedAt: new Date('2026-11-08T10:00:00Z'), status: 'reversed' },
  ],
  schedule: [
    {
      installmentNumber: 1,
      dueDate: '2026-11-08',
      principalAmount: '240',
      interestAmount: '0',
      lateFeeAmount: '0',
      paidPrincipal: '240',
      paidInterest: '0',
      paidLateFee: '0',
      status: 'paid',
    },
    {
      installmentNumber: 2,
      dueDate: '2026-12-08',
      principalAmount: '240',
      interestAmount: '0',
      lateFeeAmount: '0',
      paidPrincipal: '0',
      paidInterest: '0',
      paidLateFee: '0',
      status: 'pending',
    },
  ],
};

describe('extracto de crédito', () => {
  it('la compra es cargo, el pago es abono, el saldo se arrastra y lo revertido no cuenta', () => {
    const c = cuentasDelExtracto([credito as never], '2026-11-10');
    expect(c.movimientos.map((m) => [m.concepto, m.cargo, m.abono, m.saldo])).toEqual([
      ['Compra en Multicenter', 480, 0, 480],
      ['Pago a Multicenter', 0, 240, 240],
    ]);
    expect(c).toMatchObject({ financiado: 480, pagado: 240, saldo: 240 });
    expect(c.proximas).toEqual([{ fecha: '2026-12-08', concepto: 'Cuota 2 de 2 · Multicenter', importe: 240, vencida: false }]);
  });

  it('compone un PDF de verdad, que pagina cuando hay muchos movimientos', async () => {
    const muchos = Array.from({ length: 40 }, (_, i) => ({ ...credito, loanId: String(i + 1) }));
    const queries = {
      listByCustomer: jest.fn(async () => ({ items: muchos.map((c) => ({ loanId: c.loanId })) })),
      detail: jest.fn(async (_t: string, id: string) => muchos.find((c) => c.loanId === id)),
    };
    const customers = { nombreDelCliente: jest.fn(async () => 'Pablo Arauz') };
    const servicio = new CreditStatementService(queries as never, customers as never);

    const pdf = await servicio.pdf('1', '60', new Date('2026-11-10T12:00:00Z'));

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const paginas = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(paginas).toBeGreaterThan(1);
    if (process.env.EXTRACTO_MUESTRA) writeFileSync(process.env.EXTRACTO_MUESTRA, pdf);
  });

  it('sin créditos sale igual, en cero y sin romper', async () => {
    const servicio = new CreditStatementService(
      { listByCustomer: jest.fn(async () => ({ items: [] })), detail: jest.fn() } as never,
      { nombreDelCliente: jest.fn(async () => null) } as never,
    );
    const pdf = await servicio.pdf('1', '60');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
