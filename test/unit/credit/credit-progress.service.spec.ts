import { describe, expect, it, jest } from '@jest/globals';
import { CreditProgressService } from '../../../src/modules/credit/application/credit-progress.service.js';
import { assessPaymentCapacity } from '../../../src/modules/credit/domain/payment-capacity.js';
import type { RelationshipInput, StatementCapacityInput } from '../../../src/modules/credit/domain/payment-capacity.types.js';

/**
 * El nivel NO depende de que exista una línea de crédito: sale de la base de datos, no del motor.
 * Quien todavía no tiene línea ve igual dónde está y qué le falta.
 */
const SIN_EXTRACTO: StatementCapacityInput = {
  eligible: false,
  maxAffordableInstallment: null,
  monthlyIncome: null,
  monthlyObligations: null,
  stabilityScore: null,
  affordabilityScore: null,
  band: null,
  monthsComplete: null,
};
const RELACION: RelationshipInput = {
  tenureMonths: 3,
  loansSettled: 0,
  loansActive: 0,
  onTimeRatio: null,
  worstDaysPastDue: 0,
  chargeOffCount: 0,
  delinquencyCount12m: 0,
  monthsSinceLastLoan: null,
  kycComplete: true,
  fraudFlags: 0,
};

function armar(opciones: { linea: unknown; historial: unknown[] }) {
  const assessment = assessPaymentCapacity({
    statement: SIN_EXTRACTO,
    relationship: RELACION,
    declaredMonthlyIncome: null,
    currentLimit: null,
  });
  const capacity = { assessDetailed: jest.fn(async (_entrada: Record<string, unknown>) => ({ assessment, relationship: RELACION })) };
  const lines = { current: jest.fn(async () => opciones.linea), history: jest.fn(async () => opciones.historial) };
  return { service: new CreditProgressService(capacity as never, lines as never), capacity, lines };
}

describe('CreditProgressService', () => {
  it('sin línea de crédito igual devuelve nivel, misiones y señales (no una pantalla vacía)', async () => {
    const { service, capacity } = armar({ linea: null, historial: [] });

    const r = await service.get('1', '42');

    expect(r.hasCreditLine).toBe(false);
    expect(r.tier.code).toBeDefined();
    expect(r.missions.length).toBeGreaterThan(0);
    expect(r.signals).toMatchObject({ tenureMonths: 3, kycComplete: true, loansSettled: 0 });
    expect(r.history).toEqual([]);
    expect(capacity.assessDetailed).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '1', customerId: '42', currentLimit: null }));
  });

  it('con línea usa su límite vigente para la evaluación y devuelve el historial en el mismo orden', async () => {
    const { service, capacity } = armar({
      linea: { approvedLimit: '1500.00' },
      historial: [
        {
          validFrom: new Date('2026-09-20'),
          calculationTrigger: 'repayment',
          scoring: 640,
          approvedLimit: '1500.00',
          relationshipScore: 31,
          relationshipTier: 'EN_CONSTRUCCION',
        },
        {
          validFrom: new Date('2026-08-01'),
          calculationTrigger: 'onboarding',
          scoring: 560,
          approvedLimit: '800.00',
          relationshipScore: 12,
          relationshipTier: 'NUEVO',
        },
      ],
    });

    const r = await service.get('1', '42');

    expect(r.hasCreditLine).toBe(true);
    expect(capacity.assessDetailed).toHaveBeenCalledWith(expect.objectContaining({ currentLimit: 1500 }));
    expect(r.history.map((h) => h.trigger)).toEqual(['repayment', 'onboarding']);
    expect(r.history[0]).toMatchObject({ approvedLimit: 1500, scoring: 640, relationshipScore: 31, relationshipTier: 'EN_CONSTRUCCION' });
  });

  it('no consulta nunca al motor: sólo capacidad (base de datos) e historial', async () => {
    const { lines, capacity } = armar({ linea: null, historial: [] });
    expect(Object.keys(lines)).toEqual(['current', 'history']);
    expect(Object.keys(capacity)).toEqual(['assessDetailed']);
  });
});
