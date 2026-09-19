import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LoanCalendarService } from '../../../src/modules/loans/application/loan-calendar.service.js';
import type { LoansRepository } from '../../../src/modules/loans/loans.repository.js';
import type { PartnerDirectoryService } from '../../../src/modules/partner-onboarding/application/partner-directory.service.js';
import type { LoanInstallmentModel, LoanModel } from '../../../src/database/models/index.js';

/**
 * El calendario de pagos del cliente.
 *
 * Lo que se fija es que el color de una cuota lo decida el SERVIDOR y siempre igual. El estado es la
 * respuesta a «¿voy bien?» y no puede depender de qué pantalla la mire ni de si el teléfono tiene la
 * fecha corrida. Tres reglas que, mal escritas, mienten sin fallar: lo vencido se mide contra el
 * calendario y no contra el contador `days_past_due` —que lo actualiza un barrido y va por detrás—,
 * una cuota castigada NO es una cuota pagada, y dos cuotas del mismo día tienen que salir siempre en
 * el mismo orden o la lista se reordena sola entre recargas.
 */
const HOY = new Date('2026-09-10T12:00:00Z');

function prestamo(overrides: Partial<LoanModel> = {}): LoanModel {
  return {
    id: 'L1',
    loanCode: 'CR-1',
    status: 'active',
    currencyCode: 'BOB',
    partnerProfileId: 'pp-1',
    ...overrides,
  } as unknown as LoanModel;
}

function cuota(overrides: Partial<LoanInstallmentModel> = {}): LoanInstallmentModel {
  return {
    loanId: 'L1',
    installmentNumber: 1,
    dueDate: '2026-09-20',
    status: 'pending',
    principalAmount: '100',
    interestAmount: '10',
    lateFeeAmount: '0',
    paidPrincipal: '0',
    paidInterest: '0',
    paidLateFee: '0',
    ...overrides,
  } as unknown as LoanInstallmentModel;
}

function construir(
  prestamos: LoanModel[],
  cuotas: LoanInstallmentModel[],
  comercios = new Map<string, { displayName: string; businessCategory: string | null }>(),
) {
  const loans = {
    findLoansByCustomer: jest.fn(async () => prestamos),
    findInstallmentsForLoans: jest.fn(async () => cuotas),
  } as unknown as LoansRepository;
  const partnerDirectory = { describeMany: jest.fn(async () => comercios) } as unknown as PartnerDirectoryService;
  return { service: new LoanCalendarService(loans, partnerDirectory), loans, partnerDirectory };
}

describe('LoanCalendarService', () => {
  let comercios: Map<string, { displayName: string; businessCategory: string | null }>;

  beforeEach(() => {
    comercios = new Map([['pp-1', { displayName: 'Ferretería Sur', businessCategory: 'hardware' }]]);
  });

  describe('estado de la cuota', () => {
    it('lo vencido se mide contra el calendario del servidor, no contra el contador del préstamo', async () => {
      const { service } = construir([prestamo()], [cuota({ dueDate: '2026-09-01' })], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);

      expect(calendario.entries[0].state).toBe('overdue');
      expect(calendario.entries[0].daysPastDue).toBe(9);
    });

    it('la cuota que vence hoy todavía no está vencida', async () => {
      const { service } = construir([prestamo()], [cuota({ dueDate: '2026-09-10' })], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].state).toBe('upcoming');
      expect(calendario.entries[0].daysPastDue).toBe(0);
    });

    it('una cuota castigada no se pinta como pagada: al cliente no se le escribe un pago que no hizo', async () => {
      const { service } = construir([prestamo()], [cuota({ dueDate: '2026-09-01', status: 'written_off' })], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].state).toBe('written_off');
      expect(calendario.totals.paid).toBe(0);
      expect(calendario.totals.overdueCount).toBe(0);
    });

    it('sin saldo pendiente está pagada aunque el estado de la fila diga otra cosa', async () => {
      const { service } = construir(
        [prestamo()],
        [cuota({ dueDate: '2026-09-01', status: 'pending', paidPrincipal: '100', paidInterest: '10' })],
        comercios,
      );

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].state).toBe('paid');
      expect(calendario.entries[0].pendingAmount).toBe(0);
    });

    it('lo pagado a medias sigue vencido y su pendiente es la diferencia, nunca negativo', async () => {
      const { service } = construir([prestamo()], [cuota({ dueDate: '2026-09-01', paidPrincipal: '40' })], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].state).toBe('overdue');
      expect(calendario.entries[0].pendingAmount).toBe(70);
    });

    it('la mora forma parte de lo debido', async () => {
      const { service } = construir([prestamo()], [cuota({ dueDate: '2026-09-01', lateFeeAmount: '15.5' })], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].totalAmount).toBe(125.5);
      expect(calendario.entries[0].lateFeeAmount).toBe(15.5);
    });

    it('un importe ilegible cuenta como cero en vez de propagar NaN a la pantalla', async () => {
      const { service } = construir(
        [prestamo()],
        [cuota({ dueDate: '2026-09-20', principalAmount: 'x' as never, interestAmount: null as never })],
        comercios,
      );

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].totalAmount).toBe(0);
      expect(calendario.entries[0].state).toBe('paid');
    });
  });

  describe('la línea de tiempo', () => {
    it('ordena por fecha y, dentro del día, por comercio y número de cuota', async () => {
      comercios.set('pp-2', { displayName: 'Abarrotes Norte', businessCategory: null });
      const { service } = construir(
        [prestamo({ id: 'L1', partnerProfileId: 'pp-1' }), prestamo({ id: 'L2', loanCode: 'CR-2', partnerProfileId: 'pp-2' })],
        [
          cuota({ loanId: 'L1', installmentNumber: 2, dueDate: '2026-09-20' }),
          cuota({ loanId: 'L1', installmentNumber: 1, dueDate: '2026-09-20' }),
          cuota({ loanId: 'L2', installmentNumber: 1, dueDate: '2026-09-20' }),
          cuota({ loanId: 'L1', installmentNumber: 1, dueDate: '2026-09-15' }),
        ],
        comercios,
      );

      const calendario = await service.forCustomer('t1', 'c1', HOY);

      expect(calendario.entries.map((e) => [e.dueDate, e.merchant.displayName, e.installmentNumber])).toEqual([
        ['2026-09-15', 'Ferretería Sur', 1],
        ['2026-09-20', 'Abarrotes Norte', 1],
        ['2026-09-20', 'Ferretería Sur', 1],
        ['2026-09-20', 'Ferretería Sur', 2],
      ]);
    });

    it('los préstamos cancelados no entran ni en el calendario ni en la consulta de cuotas', async () => {
      const { service, loans } = construir(
        [prestamo({ id: 'L1' }), prestamo({ id: 'L2', status: 'cancelled' })],
        [cuota({ loanId: 'L1' }), cuota({ loanId: 'L2' })],
        comercios,
      );

      const calendario = await service.forCustomer('t1', 'c1', HOY);

      expect(loans.findInstallmentsForLoans).toHaveBeenCalledWith('t1', ['L1']);
      expect(calendario.entries).toHaveLength(1);
    });

    it('la próxima fecha es la primera por vencer, aunque haya vencidas antes en la lista', async () => {
      const { service } = construir(
        [prestamo()],
        [cuota({ installmentNumber: 1, dueDate: '2026-09-01' }), cuota({ installmentNumber: 2, dueDate: '2026-09-25' })],
        comercios,
      );

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.nextDueDate).toBe('2026-09-25');
    });

    it('sin nada por vencer la próxima fecha es nula y no la de la última vencida', async () => {
      const { service } = construir([prestamo()], [cuota({ dueDate: '2026-09-01' })], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.nextDueDate).toBeNull();
    });

    it('los totales separan vencido, por vencer y pagado, y redondean a dos decimales', async () => {
      const { service } = construir(
        [prestamo()],
        [
          cuota({ installmentNumber: 1, dueDate: '2026-09-01', principalAmount: '10.005', interestAmount: '0' }),
          cuota({ installmentNumber: 2, dueDate: '2026-09-25', principalAmount: '20', interestAmount: '0' }),
          cuota({ installmentNumber: 3, dueDate: '2026-08-01', status: 'paid', principalAmount: '30', paidPrincipal: '30' }),
        ],
        comercios,
      );

      const calendario = await service.forCustomer('t1', 'c1', HOY);

      expect(calendario.totals).toEqual({
        overdue: 10.01,
        upcoming: 20,
        paid: 30,
        overdueCount: 1,
        upcomingCount: 1,
        paidCount: 1,
      });
    });

    it('sin préstamos activos devuelve la moneda por defecto y el calendario vacío', async () => {
      const { service } = construir([], []);

      const calendario = await service.forCustomer('t1', 'c1', HOY);

      expect(calendario.currencyCode).toBe('BOB');
      expect(calendario.entries).toEqual([]);
      expect(calendario.today).toBe('2026-09-10');
      expect(calendario.generatedAt).toBe(HOY.toISOString());
    });
  });

  describe('el comercio de la cuota', () => {
    it('viaja dentro de la cuota: la pantalla del calendario no tiene la lista de créditos a mano', async () => {
      const { service } = construir([prestamo()], [cuota()], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].merchant).toEqual({
        partnerProfileId: 'pp-1',
        displayName: 'Ferretería Sur',
        businessCategory: 'hardware',
      });
    });

    it('una compra sin comercio se declara como tal en vez de dejar el nombre vacío', async () => {
      const { service } = construir([prestamo({ partnerProfileId: null })], [cuota()], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].merchant).toEqual({
        partnerProfileId: null,
        displayName: 'Compra sin comercio registrado',
        businessCategory: 'sin_comercio',
      });
    });

    it('un comercio que el directorio no resuelve no arrastra su identificador a la pantalla', async () => {
      const { service } = construir([prestamo({ partnerProfileId: 'pp-desconocido' })], [cuota()], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries[0].merchant.partnerProfileId).toBeNull();
      expect(calendario.entries[0].merchant.displayName).toBe('Compra sin comercio registrado');
    });

    it('una cuota de un préstamo que no está en la lista se descarta en vez de romper el mapa', async () => {
      const { service } = construir([prestamo({ id: 'L1' })], [cuota({ loanId: 'L1' }), cuota({ loanId: 'L9' })], comercios);

      const calendario = await service.forCustomer('t1', 'c1', HOY);
      expect(calendario.entries).toHaveLength(1);
    });
  });
});
