import { describe, expect, it, jest } from '@jest/globals';
import { DEFAULT_CARD_TIERS, resolveCardTier } from '../../../src/modules/credit/domain/card-tier.js';
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

function armar(opciones: { linea: unknown; historial: unknown[]; prestamos?: unknown[]; cuotas?: unknown[] }) {
  const assessment = assessPaymentCapacity({
    statement: SIN_EXTRACTO,
    relationship: RELACION,
    declaredMonthlyIncome: null,
    currentLimit: null,
  });
  const capacity = { assessDetailed: jest.fn(async (_entrada: Record<string, unknown>) => ({ assessment, relationship: RELACION })) };
  const lines = { current: jest.fn(async () => opciones.linea), history: jest.fn(async () => opciones.historial) };
  const cards = {
    resolveFor: jest.fn(async (_t: string, _c: string, nivel: Parameters<typeof resolveCardTier>[0]['levelCode']) => ({
      ...resolveCardTier({ levelCode: nivel, catalog: DEFAULT_CARD_TIERS, override: null, now: new Date() }),
      manual: null,
    })),
    catalog: jest.fn(async (_t: string) => DEFAULT_CARD_TIERS),
  };
  const loans = { findAll: jest.fn(async (_o: unknown) => opciones.prestamos ?? []) };
  const installments = { findAll: jest.fn(async (_o: unknown) => opciones.cuotas ?? []) };
  return {
    service: new CreditProgressService(capacity as never, lines as never, cards as never, loans as never, installments as never),
    capacity,
    lines,
    loans,
    installments,
    cards,
  };
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

  it('la experiencia sale de lo COMPRADO: 1 punto por boliviano de las compras activas o pagadas', async () => {
    const { service } = armar({
      linea: null,
      historial: [],
      prestamos: [
        { id: 'l1', status: 'active', principalAmount: '350.60' },
        { id: 'l2', status: 'paid_off', principalAmount: '200.00' },
        // No suman: anulada, sin desembolsar y castigada.
        { id: 'l3', status: 'cancelled', principalAmount: '9000.00' },
        { id: 'l4', status: 'pending_disbursement', principalAmount: '9000.00' },
        { id: 'l5', status: 'written_off', principalAmount: '9000.00' },
      ],
      cuotas: [
        { dueDate: '2026-08-01', status: 'paid', daysPastDue: 0, paidPrincipal: '90.00', paidInterest: '10.00', paidLateFee: '0' },
        // Pagada tarde: no cuenta para las insignias de pago, aunque se haya pagado completa y con recargo.
        { dueDate: '2026-09-01', status: 'paid', daysPastDue: 8, paidPrincipal: '90.00', paidInterest: '10.00', paidLateFee: '5.00' },
      ],
    });

    const r = await service.get('1', '42');

    expect(r.experience.xp).toBe(550);
    expect(r.experience.paidOnTime).toBe(100);
    expect(r.experience.onTimeInstallments).toBe(1);
    expect(r.experience.badges.find((b) => b.code === 'primera_compra')!.earned).toBe(true);
    expect(r.experience.badges.find((b) => b.code === 'cien_bs')!.earned).toBe(true);
  });

  it('publica el Puntaje (puntos de experiencia) y la Calificación 1-100 como campos con su nombre', async () => {
    const { service } = armar({
      linea: null,
      historial: [],
      prestamos: [{ id: 'l1', status: 'active', principalAmount: '100.00' }],
      cuotas: [{ dueDate: '2026-08-01', status: 'paid', daysPastDue: 0, paidPrincipal: '90.00', paidInterest: '10.00', paidLateFee: '0' }],
    });

    const r = await service.get('1', '42');

    expect(r.points).toEqual({ value: r.experience.xp, currentStreak: r.experience.currentStreak, bestStreak: r.experience.bestStreak });
    expect(r.points.value).toBe(100);
    expect(r.rating.scale).toEqual({ min: 1, max: 100 });
    expect(r.rating.value).toBe(Math.max(1, Math.min(100, Math.round(r.score))));
  });

  it('el NIVEL y la tarjeta Normal…Black salen de los PUNTOS, no de la calificación 1-100', async () => {
    const { service, cards } = armar({
      linea: null,
      historial: [],
      prestamos: [{ id: 'l1', status: 'active', principalAmount: '2100.00' }],
      cuotas: [{ dueDate: '2026-08-01', status: 'paid', daysPastDue: 0, paidPrincipal: '2000.00', paidInterest: '100.00' }],
    });

    const r = await service.get('1', '42');

    expect(r.experience.xp).toBeGreaterThanOrEqual(2_000);
    expect(r.level).toMatchObject({ code: 'ESTABLECIDO', points: r.experience.xp });
    const [[, , nivelPedido]] = cards.resolveFor.mock.calls as unknown as [[string, string, string]];
    expect(nivelPedido).toBe(r.level.code);
    expect((r.card as unknown as { levelCode: string }).levelCode).toBe(r.level.code);
    // La calificación sigue siendo la de la relación, en su escala 1-100.
    expect(r.rating.value).toBe(Math.max(1, Math.min(100, Math.round(r.score))));
  });

  it('sin compras el nivel es Nuevo con 0 puntos, aunque la calificación no sea 0', async () => {
    const { service } = armar({ linea: null, historial: [] });

    const r = await service.get('1', '42');

    expect(r.level).toMatchObject({ code: 'NUEVO', points: 0 });
    expect(r.nextLevel).toMatchObject({ code: 'EN_CONSTRUCCION', pointsMissing: 500 });
    expect(r.levelLadder).toHaveLength(5);
  });

  it('sin compras, la experiencia es 0 y ni siquiera consulta las cuotas', async () => {
    const { service, installments } = armar({ linea: null, historial: [] });

    const r = await service.get('1', '42');

    expect(r.experience).toMatchObject({ xp: 0, onTimeInstallments: 0, bestStreak: 0 });
    expect(installments.findAll).not.toHaveBeenCalled();
  });

  it('trae la tarjeta del cliente (la de su nivel) y el escalón completo', async () => {
    const { service, cards } = armar({ linea: null, historial: [] });

    const r = await service.get('1', '42');

    expect(cards.resolveFor).toHaveBeenCalledWith('1', '42', r.level.code);
    expect(r.card.source).toBe('AUTOMATICA');
    expect(r.card.catalog.map((t: { code: string }) => t.code)).toEqual(['NORMAL', 'SILVER', 'GOLD', 'PREMIUM', 'BLACK']);
    expect(r.card.catalog.filter((t: { current: boolean }) => t.current)).toHaveLength(1);
  });

  it('la respuesta al cliente NO lleva el motivo ni el autor de un ajuste manual', async () => {
    const { service } = armar({ linea: null, historial: [] });

    const r = await service.get('1', '42');

    expect(JSON.stringify(r.card)).not.toMatch(/reason|setBy|revoke/i);
  });

  it('levelOf devuelve el nivel por puntos (lee las compras) y no consulta el historial', async () => {
    const { service, installments, lines } = armar({
      linea: null,
      historial: [],
      prestamos: [{ id: 'l1', status: 'paid_off', principalAmount: '600.00' }],
      cuotas: [{ dueDate: '2026-08-01', status: 'paid', daysPastDue: 0, paidPrincipal: '600.00', paidInterest: '0' }],
    });

    const nivel = await service.levelOf('1', '42');

    expect(nivel.level.code).toBe('EN_CONSTRUCCION');
    expect(installments.findAll).toHaveBeenCalled();
    expect(lines.history).not.toHaveBeenCalled();
  });
});
