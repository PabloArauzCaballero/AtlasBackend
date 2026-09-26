import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { UnderwritingCreditHistoryService } from '../../../src/modules/decision-engine/underwriting-credit-history.service.js';
import type { LoanInstallmentModel, LoanModel } from '../../../src/database/models/index.js';

/**
 * El historial de pago del cliente DENTRO de Atlas.
 *
 * Es lo único que se sabe con certeza sobre cómo paga, y por eso pesa: sustituye a un buró que aquí
 * no existe. El peor tramo de mora y el número de moras en doce meses son entradas directas del
 * artefacto, y son las que hacen que entrar en mora cueste puntaje.
 *
 * La decisión central: sin historial NO se parte de cero. Cero es «paga fatal», y quien no ha
 * pedido nunca no paga fatal — simplemente no ha pagado. Se parte de un valor medio y la política
 * decide. Confundir las dos cosas rechaza sistemáticamente a todo cliente nuevo, que es justo el
 * que este producto existe para atender.
 *
 * El peor tramo se mide contra el CALENDARIO y sólo se contrasta con el que dejó el barrido: ese
 * contador lo actualiza un proceso periódico y puede ir por detrás, así que la mora de hoy no puede
 * depender de cuándo corrió por última vez.
 */
const AHORA = new Date('2026-09-10T12:00:00Z');

function prestamo(overrides: Record<string, unknown> = {}): LoanModel {
  return {
    id: 'L1',
    status: 'active',
    delinquencyBucket: 'current',
    disbursedAt: new Date('2026-03-10T00:00:00Z'),
    ...overrides,
  } as unknown as LoanModel;
}

function cuota(overrides: Record<string, unknown> = {}): LoanInstallmentModel {
  return {
    loanId: 'L1',
    status: 'pending',
    dueDate: '2026-09-20',
    daysPastDue: 0,
    principalAmount: '100',
    interestAmount: '10',
    ...overrides,
  } as unknown as LoanInstallmentModel;
}

describe('UnderwritingCreditHistoryService', () => {
  let loans: { findAll: jest.Mock };
  let installments: { findAll: jest.Mock };
  let service: UnderwritingCreditHistoryService;

  beforeEach(() => {
    loans = { findAll: jest.fn(async () => []) };
    installments = { findAll: jest.fn(async () => []) };
    service = new UnderwritingCreditHistoryService(
      loans as unknown as typeof LoanModel,
      installments as unknown as typeof LoanInstallmentModel,
    );
  });

  describe('sin historial', () => {
    it('el puntaje de pago parte del MEDIO y no de cero: cero es «paga fatal»', async () => {
      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.paymentHistoryScore).toBe(50);
      expect(historial.loanCount).toBe(0);
      expect(historial.worstStatus).toBe('CURRENT');
      expect(installments.findAll).not.toHaveBeenCalled();
    });

    it('todo lo demás es cero, que ahí sí es el valor cierto', async () => {
      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial).toMatchObject({ delinquencyCount12m: 0, chargeOffCount: 0, oldestTradeAgeMonths: 0, monthlyCommitted: 0 });
    });
  });

  describe('con créditos pero sin cuotas pagadas', () => {
    it('el puntaje sigue en el medio: no hay con qué medir todavía', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo()] as never);
      installments.findAll.mockResolvedValueOnce([cuota()] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.paymentHistoryScore).toBe(50);
    });

    it('las cuotas se piden sólo para los créditos de ese cliente', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo({ id: 1 }), prestamo({ id: 2 })] as never);

      await service.creditHistory('t1', 'c1', AHORA);

      const condicion = (installments.findAll.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }).where;
      expect(condicion.tenantId).toBe('t1');
      expect((condicion.loanId as Record<symbol, string[]>)[Op.in]).toEqual(['1', '2']);
    });
  });

  describe('el puntaje de pago', () => {
    it('es la proporción de cuotas pagadas A TIEMPO sobre las pagadas', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo()] as never);
      installments.findAll.mockResolvedValueOnce([
        cuota({ status: 'paid', daysPastDue: 0 }),
        cuota({ status: 'paid', daysPastDue: 0 }),
        cuota({ status: 'paid', daysPastDue: 0 }),
        cuota({ status: 'paid', daysPastDue: 12 }),
      ] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.paymentHistoryScore).toBe(75);
    });

    it('quien pagó todo a tiempo llega a 100, y quien pagó todo tarde a 0', async () => {
      loans.findAll.mockResolvedValue([prestamo()] as never);

      installments.findAll.mockResolvedValueOnce([cuota({ status: 'paid', daysPastDue: 0 })] as never);
      await expect(service.creditHistory('t1', 'c1', AHORA)).resolves.toHaveProperty('paymentHistoryScore', 100);

      installments.findAll.mockResolvedValueOnce([cuota({ status: 'paid', daysPastDue: 30 })] as never);
      await expect(service.creditHistory('t1', 'c1', AHORA)).resolves.toHaveProperty('paymentHistoryScore', 0);
    });
  });

  describe('la mora', () => {
    it('cuenta lo vencido SIN pagar y dentro de la ventana de doce meses', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo()] as never);
      installments.findAll.mockResolvedValueOnce([
        cuota({ dueDate: '2026-08-01' }),
        cuota({ dueDate: '2024-01-01' }),
        cuota({ dueDate: '2026-08-01', status: 'paid', daysPastDue: 40 }),
        cuota({ dueDate: '2026-12-01' }),
      ] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.delinquencyCount12m).toBe(1);
    });

    it('el peor tramo se mide contra el CALENDARIO, no contra el contador del barrido', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo({ delinquencyBucket: 'current' })] as never);
      installments.findAll.mockResolvedValueOnce([cuota({ dueDate: '2026-04-01' })] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.worstStatus).toBe('DPD_120_PLUS');
    });

    it('sin mora en el calendario se usa el tramo que dejó el barrido', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo({ delinquencyBucket: 'dpd_60_89' })] as never);
      installments.findAll.mockResolvedValueOnce([cuota({ dueDate: '2026-12-01' })] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.worstStatus).toBe('DPD_60');
    });

    it('un tramo desconocido del barrido se lee como al corriente, no como el peor', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo({ delinquencyBucket: 'algo_nuevo' })] as never);
      installments.findAll.mockResolvedValueOnce([] as never);

      await expect(service.creditHistory('t1', 'c1', AHORA)).resolves.toHaveProperty('worstStatus', 'CURRENT');
    });

    it('los cortes del calendario caen donde dice la escala', () => {
      expect(service.worstStatusOf(200, 'current')).toBe('DPD_120_PLUS');
      expect(service.worstStatusOf(120, 'current')).toBe('DPD_120_PLUS');
      expect(service.worstStatusOf(90, 'current')).toBe('DPD_90');
      expect(service.worstStatusOf(60, 'current')).toBe('DPD_60');
      expect(service.worstStatusOf(1, 'current')).toBe('DPD_30');
      expect(service.worstStatusOf(0, 'current')).toBe('CURRENT');
    });

    it('sin tramo del barrido tampoco se inventa uno', () => {
      expect(service.worstStatusOf(0, undefined)).toBe('CURRENT');
    });
  });

  describe('el resto de rasgos', () => {
    it('los castigados se cuentan aparte de los activos', async () => {
      loans.findAll.mockResolvedValueOnce([
        prestamo({ id: 1, status: 'active' }),
        prestamo({ id: 2, status: 'written_off' }),
        prestamo({ id: 3, status: 'closed' }),
      ] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.chargeOffCount).toBe(1);
      expect(historial.loanCount).toBe(3);
    });

    it('la antigüedad sale del desembolso MÁS VIEJO', async () => {
      loans.findAll.mockResolvedValueOnce([
        prestamo({ id: 1, disbursedAt: new Date('2026-06-10T00:00:00Z') }),
        prestamo({ id: 2, disbursedAt: new Date('2026-01-10T00:00:00Z') }),
      ] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.oldestTradeAgeMonths).toBe(7);
    });

    it('sin ninguna fecha de desembolso la antigüedad es cero y no negativa', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo({ disbursedAt: null })] as never);

      await expect(service.creditHistory('t1', 'c1', AHORA)).resolves.toHaveProperty('oldestTradeAgeMonths', 0);
    });

    it('el compromiso mensual sale de lo pendiente: quien ya tiene cuotas corriendo no dispone del mismo sueldo', async () => {
      loans.findAll.mockResolvedValueOnce([prestamo()] as never);
      installments.findAll.mockResolvedValueOnce([
        cuota({ principalAmount: '100', interestAmount: '10' }),
        cuota({ principalAmount: '100', interestAmount: '10' }),
        cuota({ principalAmount: '100', interestAmount: '10' }),
        cuota({ status: 'paid', principalAmount: '999', interestAmount: '999' }),
      ] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.monthlyCommitted).toBe(110);
    });

    it('un desembolso de las últimas 24 horas se cuenta aparte: es la señal de ráfaga', async () => {
      loans.findAll.mockResolvedValueOnce([
        prestamo({ id: 1, disbursedAt: new Date(AHORA.getTime() - 3 * 3_600_000) }),
        prestamo({ id: 2, disbursedAt: new Date(AHORA.getTime() - 5 * 86_400_000) }),
        prestamo({ id: 3, disbursedAt: null }),
      ] as never);

      const historial = await service.creditHistory('t1', 'c1', AHORA);

      expect(historial.applications24h).toBe(1);
      expect(historial.applications6m).toBe(3);
    });
  });
});
