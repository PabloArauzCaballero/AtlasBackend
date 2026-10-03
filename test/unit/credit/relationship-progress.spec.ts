import { describe, expect, it } from '@jest/globals';
import { assessPaymentCapacity } from '../../../src/modules/credit/domain/payment-capacity.js';
import type { RelationshipInput, StatementCapacityInput } from '../../../src/modules/credit/domain/payment-capacity.types.js';
import { buildRelationshipProgress } from '../../../src/modules/credit/domain/relationship-progress.js';

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
