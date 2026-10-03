import { describe, expect, it } from '@jest/globals';
import { buildExperience, type ExperienceInput, type InstallmentFact } from '../../../src/modules/credit/domain/experience.js';

/**
 * 1 punto por cada boliviano pagado A TIEMPO. Comprar no suma: sólo lo que se paga sin atraso.
 */
const HOY = '2026-10-03';
const cuota = (dueDate: string, extra: Partial<InstallmentFact> = {}): InstallmentFact => ({
  dueDate,
  status: 'paid',
  daysPastDue: 0,
  paidAmount: 100,
  ...extra,
});
const base = (installments: InstallmentFact[], extra: Partial<ExperienceInput> = {}): ExperienceInput => ({
  installments,
  loansEver: 1,
  loansSettled: 0,
  kycComplete: false,
  tenureMonths: 0,
  today: HOY,
  ...extra,
});
const insignia = (r: ReturnType<typeof buildExperience>, code: string) => r.badges.find((b) => b.code === code)!;

describe('puntos por boliviano pagado a tiempo', () => {
  it('suma 1 por cada boliviano de las cuotas pagadas a tiempo', () => {
    expect(buildExperience(base([cuota('2026-08-01', { paidAmount: 120.4 }), cuota('2026-09-01', { paidAmount: 80.9 })])).xp).toBe(201);
  });

  it('una cuota pagada con atraso suma 0', () => {
    expect(buildExperience(base([cuota('2026-08-01'), cuota('2026-09-01', { daysPastDue: 6 })])).xp).toBe(100);
  });

  it('una cuota sin pagar o pendiente no suma', () => {
    expect(
      buildExperience(
        base([cuota('2026-08-01', { status: 'pending', paidAmount: 0 }), cuota('2026-11-01', { status: 'pending', paidAmount: 0 })]),
      ).xp,
    ).toBe(0);
  });

  it('sin cuotas, 0 puntos y ninguna racha', () => {
    const r = buildExperience(base([], { loansEver: 0 }));
    expect(r).toMatchObject({ xp: 0, onTimeInstallments: 0, currentStreak: 0, bestStreak: 0 });
  });

  it('la experiencia no depende de cuánto se compró: ni siquiera recibe ese dato', () => {
    // El tipo de entrada no tiene «monto comprado»: comprar más no puede sumar puntos.
    expect(Object.keys(base([]))).not.toContain('purchasedAmount');
  });

  it('un importe negativo o corrupto no resta ni rompe la cuenta', () => {
    expect(buildExperience(base([cuota('2026-08-01', { paidAmount: -50 }), cuota('2026-09-01', { paidAmount: 40 })])).xp).toBe(40);
  });
});

describe('rachas', () => {
  it('cuenta las cuotas seguidas a tiempo, de la más antigua a la más reciente', () => {
    const r = buildExperience(base([cuota('2026-06-01'), cuota('2026-07-01'), cuota('2026-08-01'), cuota('2026-09-01')]));
    expect(r.currentStreak).toBe(4);
    expect(r.bestStreak).toBe(4);
  });

  it('un atraso rompe la racha actual pero conserva la mejor', () => {
    const r = buildExperience(
      base([cuota('2026-05-01'), cuota('2026-06-01'), cuota('2026-07-01'), cuota('2026-08-01', { daysPastDue: 9 }), cuota('2026-09-01')]),
    );
    expect(r.bestStreak).toBe(3);
    expect(r.currentStreak).toBe(1);
  });

  it('una cuota vencida y sin pagar rompe la racha', () => {
    const r = buildExperience(base([cuota('2026-07-01'), cuota('2026-08-01', { status: 'pending', paidAmount: 0 }), cuota('2026-09-01')]));
    expect(r.currentStreak).toBe(1);
  });

  it('las cuotas que aún no vencen no rompen ni suman a la racha', () => {
    const r = buildExperience(base([cuota('2026-08-01'), cuota('2026-09-01'), cuota('2026-12-01', { status: 'pending', paidAmount: 0 })]));
    expect(r.currentStreak).toBe(2);
  });
});

describe('insignias', () => {
  it('quien no ha hecho nada no tiene ninguna ganada y ve su avance en cada una', () => {
    const r = buildExperience(base([], { loansEver: 0 }));
    expect(r.badges.filter((b) => b.earned)).toEqual([]);
    expect(r.badges.every((b) => b.current <= b.target && b.target > 0)).toBe(true);
  });

  it('se ganan por lo que se hizo y llevan el avance parcial de las demás', () => {
    const r = buildExperience(
      base([cuota('2026-07-01'), cuota('2026-08-01'), cuota('2026-09-01')], { loansSettled: 1, kycComplete: true, tenureMonths: 5 }),
    );
    expect(insignia(r, 'primera_compra').earned).toBe(true);
    expect(insignia(r, 'primer_pago').earned).toBe(true);
    expect(insignia(r, 'racha_3').earned).toBe(true);
    expect(insignia(r, 'racha_6')).toMatchObject({ earned: false, current: 3, target: 6 });
    expect(insignia(r, 'compra_cerrada').earned).toBe(true);
    expect(insignia(r, 'cien_bs').earned).toBe(true);
    expect(insignia(r, 'mil_bs')).toMatchObject({ earned: false, current: 300, target: 1000 });
    expect(insignia(r, 'identidad').earned).toBe(true);
    expect(insignia(r, 'un_ano')).toMatchObject({ earned: false, current: 5, target: 12 });
  });

  it('el avance nunca pasa de la meta, aunque se haya superado', () => {
    const r = buildExperience(base([cuota('2026-09-01', { paidAmount: 9000 })]));
    expect(insignia(r, 'cinco_mil_bs')).toMatchObject({ earned: true, current: 5000, target: 5000 });
  });

  it('cada insignia tiene un código único', () => {
    const codigos = buildExperience(base([])).badges.map((b) => b.code);
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});
