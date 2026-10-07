import { describe, expect, it, jest } from '@jest/globals';
import { UnderwritingFeaturesService } from '../../../src/modules/decision-engine/underwriting-features.service.js';
import {
  NO_STATEMENT,
  statementSignalsOf,
  statementVariables,
  type StatementSignals,
} from '../../../src/modules/decision-engine/underwriting-statement.service.js';
import { lineProbeAmount, lineRateWithinUsuryCap } from '../../../src/modules/credit/application/credit-line-recalculation.service.js';
import { assessPaymentCapacity } from '../../../src/modules/credit/domain/payment-capacity.js';

/**
 * Lo que el artefacto de crédito 2.2.0 necesita de Core (revisión financiera del 2026-10-06):
 *
 * - el ingreso VERIFICADO del extracto manda sobre el declarado, y las señales de conducta de la cuenta viajan;
 * - un dato que falta no se lee como el peor valor posible (situación laboral → `UNKNOWN`, antigüedad → 50);
 * - la línea se mide con lo que la capacidad propone, no con una sonda fija de Bs 5.000;
 * - la tasa que se guarda en la línea no supera el tope de usura;
 * - un crédito castigado deja la propuesta de límite en cero.
 */
const AHORA = new Date('2026-10-06T12:00:00Z');

function revision(overrides: Record<string, unknown> = {}) {
  return {
    affordabilityEligible: true,
    periodTo: '2026-09-30',
    affordabilityJson: {
      income: { monthlyRecognized: 4200 },
      obligations: { monthly: 600 },
      signals: { nsfEvents: 2, monthsEndingNegative: 1, collectionActions: 1, highRiskMonths: 0 },
    },
    ...overrides,
  } as never;
}

function build(economia: Record<string, unknown>, extracto: StatementSignals = NO_STATEMENT) {
  const signals = {
    economicAttributes: jest.fn(async () => economia),
    contactVerification: jest.fn(async () => ({ emailVerified: true, phoneVerified: true })),
    hasVerifiedAddress: jest.fn(async () => true),
    identitySignals: jest.fn(async () => ({ verified: true, liveness: true, matchScore: 90, confidence: 88, inferred: false })),
    complianceSignals: jest.fn(async () => ({ activeWatchlistMatch: false, openFraudCase: false })),
  };
  const historial = {
    creditHistory: jest.fn(async () => ({
      monthlyCommitted: 300,
      loanCount: 0,
      delinquencyCount12m: 0,
      worstStatus: 'CURRENT',
      chargeOffCount: 0,
      oldestTradeAgeMonths: 0,
      applications6m: 0,
      applications24h: 0,
      utilization: 0,
      paymentHistoryScore: 50,
    })),
  };
  return new UnderwritingFeaturesService(
    signals as never,
    historial as never,
    { signalsFor: async () => null } as never,
    { signalsFor: async () => extracto } as never,
  );
}

const pedido = { tenantId: '1', customerId: 'c1', requestedAmount: 1500, requestedTermMonths: 3, now: AHORA };

describe('el extracto verificado (statementSignalsOf)', () => {
  it('traduce la revisión vigente: ingreso reconocido, obligaciones y conducta de la cuenta', () => {
    const señales = statementSignalsOf(revision(), AHORA);

    expect(señales).toMatchObject({
      available: true,
      verifiedMonthlyIncome: 4200,
      monthlyObligations: 600,
      nsfEvents: 2,
      monthsNegative: 1,
      collectionActions: 1,
      highRiskMonths: 0,
    });
  });

  it('no cuenta un extracto no elegible, sin ingreso reconocido o caducado', () => {
    expect(statementSignalsOf(null, AHORA)).toBe(NO_STATEMENT);
    expect(statementSignalsOf(revision({ affordabilityEligible: false }), AHORA)).toBe(NO_STATEMENT);
    expect(statementSignalsOf(revision({ affordabilityJson: { income: { monthlyRecognized: 0 } } }), AHORA)).toBe(NO_STATEMENT);
    expect(statementSignalsOf(revision({ periodTo: '2026-01-31' }), AHORA)).toBe(NO_STATEMENT);
  });

  it('sin extracto las variables viajan en cero y ausentes, con `statement_available` en falso', () => {
    const procedencia: Record<string, string> = {};
    const put = <T>(key: string, value: T, from: string): T => {
      procedencia[key] = from;
      return value;
    };

    const variables = statementVariables(NO_STATEMENT, put as never);

    expect(variables).toMatchObject({ statement_available: false, statement_nsf_events: 0, statement_collection_actions: 0 });
    expect(procedencia.statement_nsf_events).toBe('ausente');
  });
});

describe('UnderwritingFeaturesService.build · artefacto 2.2.0', () => {
  it('con extracto vigente la cuota se mide contra el ingreso VERIFICADO, no contra el declarado', async () => {
    const service = build({ monthly_income_declared: 9000 }, statementSignalsOf(revision(), AHORA));

    const { variables, provenance, affordabilityIncome } = await service.build(pedido);

    expect(affordabilityIncome).toBe(4200);
    expect(variables.affordability_ratio).toBe(0.119);
    expect(provenance.affordability_ratio).toBe('expediente');
    // Deuda-ingreso con las obligaciones observadas en la cuenta más la cuota de Atlas: (600 + 300) / 4200.
    expect(variables.debt_to_income_ratio).toBe(0.214);
    expect(variables.statement_available).toBe(true);
    expect(variables.statement_collection_actions).toBe(1);
  });

  it('sin extracto se usa lo declarado, como antes', async () => {
    const service = build({ monthly_income_declared: 2500 });

    const { variables, affordabilityIncome } = await service.build(pedido);

    expect(affordabilityIncome).toBe(2500);
    expect(variables.affordability_ratio).toBe(0.2);
    expect(variables.statement_available).toBe(false);
  });

  it('sin situación laboral declarada viaja `UNKNOWN`, no `UNEMPLOYED` (que sumaba 60 puntos)', async () => {
    const { variables, provenance } = await build({ monthly_income_declared: 2500 }).build(pedido);

    expect(variables.employment_status).toBe('UNKNOWN');
    expect(variables.self_employed_flag).toBe(false);
    expect(provenance.employment_status).toBe('ausente');
  });

  it('una situación laboral que no está en el vocabulario también es `UNKNOWN`', async () => {
    const { variables } = await build({ monthly_income_declared: 2500, __employmentStatus: 'jubilado_parcial' }).build(pedido);

    expect(variables.employment_status).toBe('UNKNOWN');
  });

  it('sin antigüedad declarada la estabilidad es el valor medio, no cero', async () => {
    const { variables, provenance } = await build({ monthly_income_declared: 2500 }).build(pedido);

    expect(variables.income_stability_score).toBe(50);
    expect(provenance.income_stability_score).toBe('ausente');
  });
});

describe('la línea (recálculo)', () => {
  it('la sonda es lo que la capacidad propone; sin propuesta, el mínimo útil del producto', () => {
    expect(lineProbeAmount({ recommendedLimit: 1200 })).toBe(1200);
    expect(lineProbeAmount({ recommendedLimit: 0 })).toBe(300);
  });

  it('la tasa guardada no supera el tope de usura, igual que en el desembolso', () => {
    expect(lineRateWithinUsuryCap(42, 0.24)).toBe(24);
    expect(lineRateWithinUsuryCap(18, 0.24)).toBe(18);
    expect(lineRateWithinUsuryCap(null, 0.24)).toBeNull();
  });
});

describe('la capacidad de pago con un crédito castigado', () => {
  it('no propone ningún límite, aunque el extracto soporte más', () => {
    const evaluacion = assessPaymentCapacity({
      statement: {
        eligible: true,
        maxAffordableInstallment: 800,
        monthlyIncome: 5000,
        monthlyObligations: 0,
        stabilityScore: 90,
        affordabilityScore: 80,
        band: 'SOLIDA',
        monthsComplete: 3,
      },
      relationship: {
        tenureMonths: 24,
        loansSettled: 3,
        loansActive: 0,
        onTimeRatio: 0.9,
        worstDaysPastDue: 0,
        chargeOffCount: 1,
        delinquencyCount12m: 0,
        monthsSinceLastLoan: 2,
        kycComplete: true,
        fraudFlags: 0,
      },
      declaredMonthlyIncome: 5000,
      currentLimit: null,
    });

    expect(evaluacion.recommendedLimit).toBe(0);
    expect(evaluacion.reasons.map((reason) => reason.code)).toContain('CAP_CREDITO_CASTIGADO');
    expect(evaluacion.reasons.map((reason) => reason.code)).not.toContain('CAP_POR_DEBAJO_DEL_MINIMO');
  });
});

describe('la fecha de lo que sale del extracto', () => {
  it('con ingreso verificado, el ratio y la deuda-ingreso se fechan con el fin del período del extracto', async () => {
    const service = build({ monthly_income_declared: 9000 }, statementSignalsOf(revision(), AHORA));

    const { variableMetadata } = await service.build(pedido);

    expect(variableMetadata.affordability_ratio?.observedAt).toBe(new Date('2026-09-30').toISOString());
    expect(variableMetadata.statement_nsf_events?.observedAt).toBe(new Date('2026-09-30').toISOString());
  });

  it('sin extracto no se inventa ninguna fecha para las statement_*', async () => {
    const { variableMetadata } = await build({ monthly_income_declared: 2500 }).build(pedido);

    expect(variableMetadata.statement_nsf_events).toBeUndefined();
  });
});
