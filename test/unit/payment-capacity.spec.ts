/**
 * La propuesta de límite: cuánto deberíamos aprobarle y por qué esa cifra.
 *
 * Lo que se fija aquí son los invariantes que hacen que la propuesta signifique algo. Un cambio que
 * los rompa no es una recalibración: es otro modelo.
 */
import {
  assessPaymentCapacity,
  DEFAULT_CAPACITY_POLICY,
  type RelationshipInput,
  type StatementCapacityInput,
} from '../../src/modules/credit/domain/payment-capacity.js';

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

function extracto(maxInstallment: number): StatementCapacityInput {
  return {
    eligible: true,
    maxAffordableInstallment: maxInstallment,
    monthlyIncome: 8000,
    monthlyObligations: 1000,
    stabilityScore: 90,
    affordabilityScore: 80,
    band: 'SOLIDA',
    monthsComplete: 3,
  };
}

const NUEVO: RelationshipInput = {
  tenureMonths: 0,
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

const VETERANO: RelationshipInput = {
  tenureMonths: 24,
  loansSettled: 4,
  loansActive: 1,
  onTimeRatio: 1,
  worstDaysPastDue: 0,
  chargeOffCount: 0,
  delinquencyCount12m: 0,
  monthsSinceLastLoan: 1,
  kycComplete: true,
  fraudFlags: 0,
};

describe('propuesta de límite de crédito', () => {
  it('un cliente nuevo con extracto excelente NO recibe el límite máximo el primer día', () => {
    /*
     * Es el invariante más importante del modelo. La capacidad es un techo físico y la relación es
     * un techo de confianza; con sólo el primero, el fraude de primera compra —el riesgo más caro
     * del crédito al consumo— tendría el límite máximo disponible desde el minuto uno.
     */
    const propuesta = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: NUEVO,
      declaredMonthlyIncome: 8000,
      currentLimit: null,
    });

    expect(propuesta.ceilings.byCapacity).toBe(9_000);
    expect(propuesta.recommendedLimit).toBe(DEFAULT_CAPACITY_POLICY.starterCap);
    expect(propuesta.bindingConstraint).toBe('RELACION');
    expect(propuesta.relationshipTier).toBe('NUEVO');
  });

  it('un cliente veterano y cumplidor escala, y aun así no supera lo que su extracto soporta', () => {
    const propuesta = assessPaymentCapacity({
      statement: extracto(400),
      relationship: VETERANO,
      declaredMonthlyIncome: 8000,
      currentLimit: 5_000,
    });

    expect(propuesta.relationshipTier).toBe('PREFERENTE');
    // Su relación permite 9.000, su extracto sólo 1.200. Manda el extracto.
    expect(propuesta.ceilings.byRelationship).toBe(9_000);
    expect(propuesta.recommendedLimit).toBe(1_200);
    expect(propuesta.bindingConstraint).toBe('CAPACIDAD');
  });

  it('el límite sube por pasos, nunca de golpe', () => {
    const propuesta = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: VETERANO,
      declaredMonthlyIncome: 8000,
      currentLimit: 1_500,
    });

    expect(propuesta.recommendedLimit).toBe(3_000);
    expect(propuesta.bindingConstraint).toBe('GRADUACION');
  });

  it('sin historial NO se parte del suelo: quien no ha pedido nunca no paga mal', () => {
    const sinHistorial = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: NUEVO,
      declaredMonthlyIncome: 8000,
      currentLimit: null,
    });
    const conMalHistorial = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: { ...NUEVO, loansSettled: 2, onTimeRatio: 0.2, worstDaysPastDue: 45 },
      declaredMonthlyIncome: 8000,
      currentLimit: null,
    });

    expect(sinHistorial.components.paymentHistory).toBe(50);
    expect(conMalHistorial.components.paymentHistory).toBeLessThan(sinHistorial.components.paymentHistory);
  });

  it('un crédito castigado pesa más que cualquier cosa buena que se pueda decir', () => {
    const propuesta = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: { ...VETERANO, chargeOffCount: 1 },
      declaredMonthlyIncome: 8000,
      currentLimit: 8_000,
    });

    // No baja a cero —su ratio de puntualidad sigue siendo real— pero cae por debajo del 50 con el
    // que parte alguien SIN historial: haber fallado es peor que no haber pedido nunca.
    expect(propuesta.components.paymentHistory).toBeLessThan(50);
    expect(propuesta.relationshipTier).not.toBe('PREFERENTE');
    expect(propuesta.reasons.map((reason) => reason.code)).toContain('CAP_CREDITO_CASTIGADO');
  });

  it('una alerta de fraude BAJA al suelo, no descuenta puntos', () => {
    const propuesta = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: { ...VETERANO, fraudFlags: 1 },
      declaredMonthlyIncome: 8000,
      currentLimit: 8_000,
    });

    expect(propuesta.relationshipScore).toBeLessThanOrEqual(10);
    expect(propuesta.relationshipTier).toBe('NUEVO');
    expect(propuesta.reasons.map((reason) => reason.code)).toContain('CAP_ALERTA_DE_FRAUDE');
  });

  it('sin extracto propone algo conservador y lo marca como declarado', () => {
    /*
     * Dejarlo en cero convertiría el extracto en un requisito de facto, y en Bolivia mucha gente no
     * tiene banca por internet. Tratar lo declarado como evidencia premiaría a quien escribe el
     * número más alto en el formulario. El punto medio es proponer poco y decir de dónde salió.
     */
    const propuesta = assessPaymentCapacity({
      statement: SIN_EXTRACTO,
      relationship: VETERANO,
      declaredMonthlyIncome: 8_000,
      currentLimit: null,
    });

    expect(propuesta.evidence).toBe('DECLARADO');
    expect(propuesta.recommendedLimit).toBe(2_400);
    expect(propuesta.reasons.map((reason) => reason.code)).toContain('CAP_SIN_EXTRACTO');
  });

  it('sin extracto y sin ingreso declarado no propone nada, y lo dice', () => {
    const propuesta = assessPaymentCapacity({
      statement: SIN_EXTRACTO,
      relationship: NUEVO,
      declaredMonthlyIncome: null,
      currentLimit: null,
    });

    expect(propuesta.recommendedLimit).toBe(0);
    expect(propuesta.bindingConstraint).toBe('SIN_CAPACIDAD');
    expect(propuesta.reasons.map((reason) => reason.code)).toContain('CAP_SIN_EVIDENCIA');
  });

  it('por debajo del mínimo útil no propone una miseria: propone nada', () => {
    const propuesta = assessPaymentCapacity({
      statement: extracto(50),
      relationship: VETERANO,
      declaredMonthlyIncome: 8_000,
      currentLimit: null,
    });

    expect(propuesta.ceilings.byCapacity).toBe(150);
    expect(propuesta.recommendedLimit).toBe(0);
    expect(propuesta.reasons.map((reason) => reason.code)).toContain('CAP_POR_DEBAJO_DEL_MINIMO');
  });

  it('el historial de pago pesa más que la antigüedad', () => {
    /*
     * Llevar tiempo no es lo mismo que cumplir. Un cliente antiguo que paga tarde tiene que valer
     * menos que uno reciente que paga a tiempo; con pesos iguales saldría al revés.
     */
    const antiguoIncumplidor = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: { ...VETERANO, onTimeRatio: 0.4, worstDaysPastDue: 45, delinquencyCount12m: 2 },
      declaredMonthlyIncome: 8000,
      currentLimit: null,
    });
    const recienteCumplidor = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: { ...VETERANO, tenureMonths: 6, loansSettled: 2, monthsSinceLastLoan: 1 },
      declaredMonthlyIncome: 8000,
      currentLimit: null,
    });

    expect(recienteCumplidor.relationshipScore).toBeGreaterThan(antiguoIncumplidor.relationshipScore);
  });

  it('ninguna combinación supera el techo del producto', () => {
    const propuesta = assessPaymentCapacity({
      statement: extracto(50_000),
      relationship: VETERANO,
      declaredMonthlyIncome: 200_000,
      currentLimit: 100_000,
      policy: { starterCap: 100_000 },
    });

    expect(propuesta.recommendedLimit).toBeLessThanOrEqual(DEFAULT_CAPACITY_POLICY.productCeiling);
  });

  it('publica su versión de modelo: una cifra sin versión no se puede comparar', () => {
    const propuesta = assessPaymentCapacity({
      statement: extracto(3000),
      relationship: NUEVO,
      declaredMonthlyIncome: 8000,
      currentLimit: null,
    });
    expect(propuesta.modelVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
