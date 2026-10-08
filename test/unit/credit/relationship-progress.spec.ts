import { describe, expect, it } from '@jest/globals';
import { assessPaymentCapacity } from '../../../src/modules/credit/domain/payment-capacity.js';
import type { RelationshipInput, StatementCapacityInput } from '../../../src/modules/credit/domain/payment-capacity.types.js';
import { buildRelationshipProgress, creditCeilingOf } from '../../../src/modules/credit/domain/relationship-progress.js';

/**
 * El nivel de un cliente como lo ve en la app: en qué escalón está, cuántos puntos le faltan para el siguiente
 * y qué acciones se los dan. Ninguna misión premia endeudarse.
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

const NUEVO: RelationshipInput = {
  tenureMonths: 0,
  loansSettled: 0,
  loansActive: 0,
  onTimeRatio: null,
  worstDaysPastDue: 0,
  chargeOffCount: 0,
  delinquencyCount12m: 0,
  monthsSinceLastLoan: null,
  kycComplete: false,
  fraudFlags: 0,
};

const progreso = (relationship: RelationshipInput, statement: StatementCapacityInput = SIN_EXTRACTO) =>
  buildRelationshipProgress(
    assessPaymentCapacity({ statement, relationship, declaredMonthlyIncome: null, currentLimit: null }),
    relationship,
  );

describe('buildRelationshipProgress', () => {
  it('un cliente recién llegado está en «Nuevo», nivel 1 de 5, y sabe qué le falta para el siguiente', () => {
    const p = progreso(NUEVO);
    expect(p.tier).toMatchObject({ code: 'NUEVO', label: 'Nuevo', index: 1, of: 5 });
    expect(p.nextTier).toMatchObject({ code: 'EN_CONSTRUCCION', from: 25 });
    expect(p.nextTier!.pointsMissing).toBe(25 - p.score);
    expect(p.nextTier!.pointsMissing).toBeGreaterThan(0);
  });

  it('la escalera va de menor a mayor, con los cinco escalones y marcando los alcanzados', () => {
    const p = progreso(NUEVO);
    expect(p.ladder.map((e) => e.code)).toEqual(['NUEVO', 'EN_CONSTRUCCION', 'ESTABLECIDO', 'CONSOLIDADO', 'PREFERENTE']);
    expect(p.ladder.map((e) => e.from)).toEqual([0, 25, 50, 70, 85]);
    expect(p.ladder.filter((e) => e.reached).map((e) => e.code)).toEqual(p.ladder.slice(0, p.tier.index).map((e) => e.code));
  });

  it('cada escalón publica su tope de crédito: el de quien empieza por su multiplicador', () => {
    const p = progreso(NUEVO);
    // La app dice «hasta Bs X» con estas cifras; no tiene escrito ningún importe.
    expect(p.ladder.map((e) => e.creditCeiling)).toEqual([1500, 2250, 3750, 6000, 9000]);
    expect(p.tier.creditCeiling).toBe(1500);
    expect(p.nextTier?.creditCeiling).toBe(2250);
    for (const e of p.ladder) expect(e.creditCeiling).toBe(1500 * e.multiplier);
  });

  it('el tope de un escalón nunca pasa del techo del producto', () => {
    expect(creditCeilingOf(6)).toBe(9000);
    expect(creditCeilingOf(100)).toBe(20_000);
  });

  it('quien ya paga a tiempo, verificó su identidad y lleva un año sube de nivel', () => {
    const p = progreso({
      ...NUEVO,
      tenureMonths: 14,
      loansSettled: 3,
      loansActive: 1,
      onTimeRatio: 1,
      kycComplete: true,
      monthsSinceLastLoan: 0,
    });
    expect(p.score).toBeGreaterThan(70);
    expect(['CONSOLIDADO', 'PREFERENTE']).toContain(p.tier.code);
  });

  it('en el último escalón no hay «siguiente nivel»', () => {
    const p = progreso({
      ...NUEVO,
      tenureMonths: 24,
      loansSettled: 4,
      loansActive: 2,
      onTimeRatio: 1,
      kycComplete: true,
      monthsSinceLastLoan: 0,
    });
    expect(p.tier.code).toBe('PREFERENTE');
    expect(p.nextTier).toBeNull();
  });

  it('los componentes salen con su peso y los pesos suman 1', () => {
    const p = progreso(NUEVO);
    expect(p.components.map((c) => c.code)).toEqual(['paymentHistory', 'loyalty', 'tenure', 'verification']);
    expect(p.components.reduce((suma, c) => suma + c.weight, 0)).toBeCloseTo(1, 5);
  });

  it('las misiones se marcan hechas según la conducta real', () => {
    const nuevo = Object.fromEntries(progreso(NUEVO).missions.map((m) => [m.code, m.done]));
    expect(nuevo).toMatchObject({
      verificar_identidad: false,
      pagar_a_tiempo: false,
      terminar_una_compra: false,
      cumplir_un_ano: false,
      subir_extracto: false,
    });
    // Sin atrasos de entrada: es lo que se protege, no lo que se gana.
    expect(nuevo.cero_atrasos).toBe(true);

    const bueno = Object.fromEntries(
      progreso(
        { ...NUEVO, tenureMonths: 13, loansSettled: 1, onTimeRatio: 1, kycComplete: true },
        { ...SIN_EXTRACTO, eligible: true, maxAffordableInstallment: 500, monthsComplete: 3 },
      ).missions.map((m) => [m.code, m.done]),
    );
    expect(bueno).toMatchObject({
      verificar_identidad: true,
      pagar_a_tiempo: true,
      terminar_una_compra: true,
      cero_atrasos: true,
      cumplir_un_ano: true,
      subir_extracto: true,
    });
  });

  it('un atraso reciente desmarca «cero atrasos»', () => {
    const p = progreso({ ...NUEVO, loansActive: 1, onTimeRatio: 0.5, worstDaysPastDue: 12, delinquencyCount12m: 1 });
    expect(p.missions.find((m) => m.code === 'cero_atrasos')!.done).toBe(false);
  });

  it('ninguna misión premia endeudarse ni pedir más crédito', () => {
    const textos = progreso(NUEVO)
      .missions.map((m) => `${m.label} ${m.detail}`.toLowerCase())
      .join(' ');
    expect(textos).not.toMatch(/pide (un |más )?crédito|endeud|solicita|gasta más/);
  });
});

/**
 * «Por qué a esta persona se le asigna este puntaje»: cada parte con los puntos que aporta y su razón, y los
 * topes que de verdad la recortaron.
 */
describe('la cuenta de cada persona', () => {
  it('los puntos de cada parte son valor × peso y suman el puntaje sin topes', () => {
    const p = progreso({ ...NUEVO, tenureMonths: 6, loansSettled: 1, onTimeRatio: 1, kycComplete: true, monthsSinceLastLoan: 2 });
    // Los puntos se muestran con un decimal: se acepta ese redondeo (± 0,05).
    for (const c of p.components) expect(Math.abs(c.points - c.value * c.weight)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.round(p.components.reduce((suma, c) => suma + c.value * c.weight, 0))).toBe(p.rawScore);
    expect(p.score).toBe(p.rawScore);
    expect(p.caps).toEqual([]);
  });

  it('con historial neutro dice por qué parte de 50 en vez de castigar', () => {
    const pagos = progreso(NUEVO).components.find((c) => c.code === 'paymentHistory')!;
    expect(pagos.value).toBe(50);
    expect(pagos.why).toMatch(/partes de 50/);
    expect(pagos.why).toMatch(/no haber pedido/);
  });

  it('la razón de pagos trae el porcentaje real y los descuentos que se aplicaron', () => {
    const pagos = progreso({ ...NUEVO, loansActive: 1, onTimeRatio: 0.8, worstDaysPastDue: 35, delinquencyCount12m: 2 }).components.find(
      (c) => c.code === 'paymentHistory',
    )!;
    expect(pagos.why).toContain('80 %');
    expect(pagos.why).toContain('30 días o más (−30)');
    expect(pagos.why).toContain('2 cuota(s) vencida(s)');
    expect(pagos.why).toContain('−20');
  });

  it('antigüedad: a los 12 meses ya está al máximo y antes dice cuándo llega', () => {
    const t = (meses: number) => progreso({ ...NUEVO, tenureMonths: meses }).components.find((c) => c.code === 'tenure')!;
    expect(t(12).why).toMatch(/máximo/);
    expect(t(4).why).toContain('4 mes(es)');
    expect(t(4).why).toContain('100 a los 12 meses');
  });

  it('identidad: dice si está verificada y qué suma al verificarla', () => {
    const v = (kyc: boolean) => progreso({ ...NUEVO, kycComplete: kyc }).components.find((c) => c.code === 'verification')!;
    expect(v(true).why).toMatch(/verificados/);
    expect(v(false).why).toMatch(/suma 100/);
  });

  it('el tope de «relación nueva» se anuncia sólo cuando de verdad recortó el resultado', () => {
    // Identidad verificada y buen historial neutro el primer día: sin tope saldría por encima de 24.
    const recortado = progreso({ ...NUEVO, tenureMonths: 0, kycComplete: true, loansActive: 1, onTimeRatio: 1 });
    if (recortado.rawScore > 24) {
      expect(recortado.score).toBe(24);
      expect(recortado.caps.map((c) => c.code)).toEqual(['RELACION_NUEVA']);
      expect(recortado.caps[0]!.limit).toBe(24);
    }
    // Con tres meses ya no aplica, aunque el resultado sea el mismo.
    expect(progreso({ ...NUEVO, tenureMonths: 3, kycComplete: true, loansActive: 1, onTimeRatio: 1 }).caps).toEqual([]);
  });

  it('una alerta de fraude abierta recorta a 10 y lo dice', () => {
    const p = progreso({
      ...NUEVO,
      tenureMonths: 20,
      loansSettled: 3,
      onTimeRatio: 1,
      kycComplete: true,
      monthsSinceLastLoan: 0,
      fraudFlags: 1,
    });
    expect(p.rawScore).toBeGreaterThan(10);
    expect(p.score).toBe(10);
    expect(p.caps.map((c) => c.code)).toContain('ALERTA_DE_FRAUDE');
  });
});
