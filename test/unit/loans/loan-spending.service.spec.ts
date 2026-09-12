import { describe, expect, it, jest } from '@jest/globals';
import { LoanSpendingService } from '../../../src/modules/loans/application/loan-spending.service.js';

/**
 * En qué gasta el cliente, agrupado por rubro y comercio.
 *
 * Es una pantalla que le dice a alguien «tienes pagos en mora», así que lo que se fija son las
 * cifras que, si se calculan de otra forma, le mienten: una cuota vencida ayer contada como
 * próxima porque el barrido nocturno aún no pasó, una compra sin comercio registrado desaparecida
 * del total, y un orden de rubros que cambia cada vez que alguien paga.
 */

const AHORA = new Date('2026-09-09T12:00:00.000Z');

function prestamo(over: Record<string, unknown> = {}) {
  return {
    id: '1',
    status: 'active',
    currencyCode: 'BOB',
    partnerProfileId: '7',
    principalAmount: '1000.00',
    paidPrincipal: '0.00',
    paidInterest: '0.00',
    paidLateFee: '0.00',
    outstandingPrincipal: '1000.00',
    ...over,
  };
}

function cuota(over: Record<string, unknown> = {}) {
  return {
    loanId: '1',
    status: 'pending',
    dueDate: '2026-12-01',
    principalAmount: '100.00',
    interestAmount: '0.00',
    lateFeeAmount: '0.00',
    paidPrincipal: '0.00',
    paidInterest: '0.00',
    paidLateFee: '0.00',
    ...over,
  };
}

function montar(
  prestamos: Record<string, unknown>[],
  cuotas: Record<string, unknown>[],
  comercios: Array<[string, Record<string, unknown>]> = [],
) {
  const loans = {
    findLoansByCustomer: jest.fn(async () => prestamos),
    findInstallmentsForLoans: jest.fn(async () => cuotas),
  };
  const partnerDirectory = { describeMany: jest.fn(async () => new Map(comercios)) };
  return { service: new LoanSpendingService(loans as never, partnerDirectory as never), loans, partnerDirectory };
}

const pedir = (s: LoanSpendingService) => s.byCategory('1', '24', AHORA);

describe('LoanSpendingService', () => {
  /*
   * Lo vencido se mide con el CALENDARIO, no con `days_past_due` del préstamo: ese contador lo
   * actualiza un barrido periódico, y entre barrido y barrido una cuota puede haber vencido con el
   * préstamo diciendo todavía que está al corriente.
   */
  it('cuenta como vencido lo que venció, aunque el préstamo no se haya enterado', async () => {
    const { service } = montar(
      [prestamo({ daysPastDue: 0 })],
      [cuota({ dueDate: '2026-08-01' }), cuota({ dueDate: '2026-12-01' })],
      [['7', { businessCategory: 'FERRETERIA', displayName: 'Ferretería Sur' }]],
    );

    const gasto = await pedir(service);

    expect(gasto.totals.overdue).toBe(100);
    expect(gasto.totals.upcoming).toBe(100);
    expect(gasto.totals.overdueLoanCount).toBe(1);
  });

  it('no cuenta lo ya pagado ni lo castigado', async () => {
    const { service } = montar(
      [prestamo()],
      [cuota({ status: 'paid', dueDate: '2026-08-01' }), cuota({ status: 'written_off', dueDate: '2026-08-02' }), cuota()],
      [['7', { businessCategory: 'FERRETERIA', displayName: 'Ferretería Sur' }]],
    );

    const gasto = await pedir(service);

    expect(gasto.totals.overdue).toBe(0);
    expect(gasto.totals.upcoming).toBe(100);
  });

  /* Una cuota parcialmente pagada sólo debe lo que le falta, no su importe entero. */
  it('de una cuota a medias sólo cuenta lo pendiente', async () => {
    const { service } = montar(
      [prestamo()],
      [cuota({ dueDate: '2026-08-01', principalAmount: '100.00', paidPrincipal: '60.00' })],
      [['7', { businessCategory: 'FERRETERIA', displayName: 'Ferretería Sur' }]],
    );

    expect((await pedir(service)).totals.overdue).toBe(40);
  });

  /* Un préstamo cancelado no es gasto: incluirlo inflaría el total financiado del cliente. */
  it('deja fuera los préstamos cancelados', async () => {
    const { service } = montar([prestamo({ status: 'cancelled' }), prestamo({ id: '2', status: 'active' })], [], []);

    expect((await pedir(service)).totals.loanCount).toBe(1);
  });

  /*
   * Una compra sin comercio registrado sigue siendo gasto del cliente. Descartarla haría que la
   * suma de los rubros no cuadrase con lo que debe.
   */
  it('agrupa aparte lo que no tiene comercio, sin perderlo del total', async () => {
    const { service } = montar(
      [prestamo({ id: '1', partnerProfileId: '7' }), prestamo({ id: '2', partnerProfileId: null })],
      [cuota({ loanId: '1' }), cuota({ loanId: '2' })],
      [['7', { businessCategory: 'FERRETERIA', displayName: 'Ferretería Sur' }]],
    );

    const gasto = await pedir(service);

    expect(gasto.totals.financed).toBe(2000);
    expect(gasto.categories).toHaveLength(2);
    const sinComercio = gasto.categories.find((c) => c.merchants.some((m) => m.partnerProfileId === null));
    expect(sinComercio?.merchants[0].displayName).toBe('Compra sin comercio registrado');
  });

  /* Un comercio conocido pero sin rubro declarado no es lo mismo que una compra sin comercio. */
  it('distingue «comercio sin rubro» de «sin comercio»', async () => {
    const { service } = montar(
      [prestamo({ id: '1', partnerProfileId: '7' }), prestamo({ id: '2', partnerProfileId: null })],
      [],
      [['7', { businessCategory: null, displayName: 'Comercio Nuevo' }]],
    );

    const claves = (await pedir(service)).categories.map((c) => c.category);
    expect(new Set(claves).size).toBe(2);
  });

  /*
   * El orden es por lo financiado y no por nombre: un tablero cuyo orden cambia con cada pago es un
   * tablero que no se puede leer de un vistazo.
   */
  it('ordena rubros y comercios de mayor a menor financiado', async () => {
    const { service } = montar(
      [
        prestamo({ id: '1', partnerProfileId: '7', principalAmount: '100.00' }),
        prestamo({ id: '2', partnerProfileId: '8', principalAmount: '900.00' }),
      ],
      [],
      [
        ['7', { businessCategory: 'FERRETERIA', displayName: 'Ferretería Sur' }],
        ['8', { businessCategory: 'FARMACIA', displayName: 'Farmacia Norte' }],
      ],
    );

    const gasto = await pedir(service);

    expect(gasto.categories.map((c) => c.category)).toEqual(['FARMACIA', 'FERRETERIA']);
    expect(gasto.categories[0].share).toBe(90);
  });

  it('con todo a cero no divide por cero al repartir el porcentaje', async () => {
    const { service } = montar([prestamo({ principalAmount: '0.00' })], [], [['7', { businessCategory: 'X', displayName: 'X' }]]);

    expect((await pedir(service)).categories[0].share).toBe(0);
  });

  /* El próximo vencimiento es el más cercano de TODOS los préstamos, no el del primero. */
  it('el próximo vencimiento es el más cercano entre todos los préstamos', async () => {
    const { service } = montar(
      [prestamo({ id: '1' }), prestamo({ id: '2' })],
      [
        cuota({ loanId: '1', dueDate: '2026-12-01' }),
        cuota({ loanId: '2', dueDate: '2026-10-15' }),
        cuota({ loanId: '2', dueDate: '2026-08-01' }),
      ],
      [['7', { businessCategory: 'X', displayName: 'X' }]],
    );

    // El del 1 de agosto ya venció: el «próximo» mira hacia adelante, no hacia atrás.
    expect((await pedir(service)).nextDueDate).toBe('2026-10-15');
  });

  it('sin préstamos devuelve totales en cero y la moneda por defecto', async () => {
    const { service } = montar([], [], []);

    const gasto = await pedir(service);

    expect(gasto.totals.financed).toBe(0);
    expect(gasto.currencyCode).toBe('BOB');
    expect(gasto.nextDueDate).toBeNull();
    expect(gasto.categories).toEqual([]);
  });
});
