import { describe, expect, it } from '@jest/globals';
import {
  buildExperience,
  REGLA_DE_PUNTOS,
  type ExperienceInput,
  type InstallmentFact,
} from '../../../src/modules/credit/domain/experience.js';

/**
 * Los puntos se ganan como en un programa de fidelidad, pero pesa más cumplir que comprar (Pablo, 2026-10-08):
 * 1 por cada Bs 10 comprados con tope por compra, 50 por cuota a tiempo, 25 más con adelanto, 200 por compra terminada.
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
  purchaseAmounts: [],
  loansEver: 1,
  loansSettled: 0,
  kycComplete: false,
  tenureMonths: 0,
  today: HOY,
  ...extra,
});
const insignia = (r: ReturnType<typeof buildExperience>, code: string) => r.badges.find((b) => b.code === code)!;

describe('puntos de experiencia', () => {
  it('cada compra da 1 punto por cada Bs 10', () => {
    const r = buildExperience(base([], { purchaseAmounts: [120.4, 80.9] }));
    expect(r.xp).toBe(12 + 8);
    expect(r.xpBreakdown.purchases).toEqual({ count: 2, points: 20 });
  });

  it('una compra grande no salta niveles: su aporte tiene tope', () => {
    expect(buildExperience(base([], { purchaseAmounts: [1_200] })).xp).toBe(REGLA_DE_PUNTOS.topePorCompra);
    expect(buildExperience(base([], { purchaseAmounts: [50_000] })).xp).toBe(REGLA_DE_PUNTOS.topePorCompra);
  });

  it('pagar bien pesa más que comprar: 50 por cuota a tiempo, nada por la que se pagó tarde', () => {
    const r = buildExperience(base([cuota('2026-08-01'), cuota('2026-09-01', { daysPastDue: 6 })]));
    expect(r.xpBreakdown.onTimeInstallments).toEqual({ count: 1, points: 50 });
    expect(r.xp).toBe(50);
  });

  it('pagar con 3 días o más de adelanto suma 25 más', () => {
    const r = buildExperience(base([cuota('2026-09-10', { paidOn: '2026-09-05' }), cuota('2026-08-10', { paidOn: '2026-08-09' })]));
    expect(r.xpBreakdown.earlyInstallments).toEqual({ count: 1, points: 25 });
    expect(r.xp).toBe(50 + 50 + 25);
  });

  it('terminar de pagar una compra suma 200', () => {
    const r = buildExperience(base([], { loansSettled: 2 }));
    expect(r.xpBreakdown.settledPurchases).toEqual({ count: 2, points: 400 });
    expect(r.xp).toBe(400);
  });

  it('el total es exactamente la suma del desglose que ve la app', () => {
    const r = buildExperience(base([cuota('2026-09-10', { paidOn: '2026-09-01' })], { purchaseAmounts: [480], loansSettled: 1 }));
    const suma = Object.values(r.xpBreakdown).reduce((t, parte) => t + parte.points, 0);
    expect(r.xp).toBe(suma);
    expect(r.xp).toBe(48 + 50 + 25 + 200);
  });

  it('lo pagado a tiempo se cuenta aparte, para las insignias de pago; lo pagado tarde no', () => {
    const r = buildExperience(base([cuota('2026-08-01', { paidAmount: 120.4 }), cuota('2026-09-01', { daysPastDue: 6 })]));
    expect(r.paidOnTime).toBe(120);
  });

  it('sin compras ni cuotas, 0 puntos y ninguna racha', () => {
    const r = buildExperience(base([], { loansEver: 0 }));
    expect(r).toMatchObject({ xp: 0, paidOnTime: 0, onTimeInstallments: 0, currentStreak: 0, bestStreak: 0 });
  });

  it('un importe negativo o corrupto no resta ni rompe la cuenta', () => {
    expect(buildExperience(base([], { purchaseAmounts: [-50, Number.NaN, 40] })).xp).toBe(4);
    expect(buildExperience(base([cuota('2026-08-01', { paidAmount: -50 }), cuota('2026-09-01', { paidAmount: 40 })])).paidOnTime).toBe(40);
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

  it('hay más de treinta, repartidas en siete colecciones y cinco rangos', () => {
    const { badges } = buildExperience(base([]));
    expect(badges.length).toBeGreaterThanOrEqual(30);
    expect(new Set(badges.map((b) => b.category)).size).toBe(7);
    expect(new Set(badges.map((b) => b.rank))).toEqual(new Set(['bronce', 'plata', 'oro', 'platino', 'diamante']));
  });

  it('las secretas llevan pista y las demás no', () => {
    const { badges } = buildExperience(base([]));
    const secretas = badges.filter((b) => b.secret).map((b) => b.code);
    expect(secretas.sort()).toEqual(['al_filo', 'domingo', 'remontada']);
    expect(badges.filter((b) => b.secret).every((b) => !!b.hint)).toBe(true);
    expect(badges.filter((b) => !b.secret).every((b) => b.hint === null)).toBe(true);
  });
});

describe('insignias de compras', () => {
  it('cuentan compras concretadas y la mayor de una sola vez', () => {
    const r = buildExperience(base([], { purchaseAmounts: [100, 600, 2_500], loansEver: 3 }));
    expect(insignia(r, 'compras_3').earned).toBe(true);
    expect(insignia(r, 'compras_10')).toMatchObject({ earned: false, current: 3, target: 10 });
    expect(insignia(r, 'compra_grande').earned).toBe(true);
    expect(insignia(r, 'compra_gigante').earned).toBe(true);
  });

  it('muchas compras chicas no hacen una compra grande', () => {
    const r = buildExperience(base([], { purchaseAmounts: [400, 400, 400] }));
    expect(insignia(r, 'compra_grande')).toMatchObject({ earned: false, current: 400 });
  });
});

describe('insignias de estilo de pago', () => {
  const pagada = (dueDate: string, paidOn: string) => cuota(dueDate, { paidOn });

  it('madrugador: 3 días o más de adelanto; 2 no alcanza', () => {
    expect(insignia(buildExperience(base([pagada('2026-09-10', '2026-09-07')])), 'madrugador').earned).toBe(true);
    expect(insignia(buildExperience(base([pagada('2026-09-10', '2026-09-08')])), 'madrugador').earned).toBe(false);
  });

  it('al filo: el mismo día del vencimiento', () => {
    expect(insignia(buildExperience(base([pagada('2026-09-10', '2026-09-10')])), 'al_filo').earned).toBe(true);
    expect(insignia(buildExperience(base([pagada('2026-09-10', '2026-09-09')])), 'al_filo').earned).toBe(false);
  });

  it('domingo: 2026-09-06 fue domingo', () => {
    expect(insignia(buildExperience(base([pagada('2026-09-10', '2026-09-06')])), 'domingo').earned).toBe(true);
    expect(insignia(buildExperience(base([pagada('2026-09-10', '2026-09-07')])), 'domingo').earned).toBe(false);
  });

  it('sin fecha de pago no se gana ninguna de estilo', () => {
    const r = buildExperience(base([cuota('2026-09-10')]));
    for (const c of ['madrugador', 'al_filo', 'domingo']) expect(insignia(r, c).earned).toBe(false);
  });

  it('una cuota pagada TARDE no cuenta como madrugada ni al filo, aunque traiga fecha', () => {
    const r = buildExperience(base([cuota('2026-09-10', { paidOn: '2026-09-10', daysPastDue: 2 })]));
    expect(insignia(r, 'al_filo').earned).toBe(false);
  });

  it('la remontada: tras un atraso, tres a tiempo; sin atraso previo no hay remontada', () => {
    const conAtraso = base([cuota('2026-04-01', { daysPastDue: 5 }), cuota('2026-05-01'), cuota('2026-06-01'), cuota('2026-07-01')]);
    expect(insignia(buildExperience(conAtraso), 'remontada').earned).toBe(true);
    const sinAtraso = base([cuota('2026-05-01'), cuota('2026-06-01'), cuota('2026-07-01')]);
    expect(insignia(buildExperience(sinAtraso), 'remontada').earned).toBe(false);
    const dosNada = base([cuota('2026-04-01', { daysPastDue: 5 }), cuota('2026-05-01'), cuota('2026-06-01')]);
    expect(insignia(buildExperience(dosNada), 'remontada').earned).toBe(false);
  });
});

describe('la colección', () => {
  it('ganar insignias es otra insignia, y no se cuenta a sí misma', () => {
    const vacio = buildExperience(base([], { loansEver: 0 }));
    expect(insignia(vacio, 'coleccionista_10').current).toBe(0);
    const lleno = buildExperience(
      base(
        Array.from({ length: 12 }, (_, i) =>
          cuota(`2026-${String(i + 1).padStart(2, '0')}-01`, { paidOn: `2026-${String(i + 1).padStart(2, '0')}-01` }),
        ),
        { purchaseAmounts: [3_000], loansSettled: 1, kycComplete: true, tenureMonths: 12 },
      ),
    );
    expect(insignia(lleno, 'coleccionista_10').earned).toBe(true);
    expect(insignia(lleno, 'coleccionista_total').earned).toBe(false);
  });
});
