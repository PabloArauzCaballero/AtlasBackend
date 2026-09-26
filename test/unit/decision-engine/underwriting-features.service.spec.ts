/**
 * @file Verifica que el expediente que se manda al Motor no afirme «limpio» lo que Atlas no sabe.
 * @business Un `CLEAR` o un `false` inventados aprueban a quien nadie cotejó; lo desconocido viaja como ausente.
 * @system Ejercita `UnderwritingFeaturesService.build` y `UnderwritingSignalsService.complianceSignals` (C-6).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { NOT_ASSESSED, UnderwritingFeaturesService } from '../../../src/modules/decision-engine/underwriting-features.service.js';
import { UnderwritingSignalsService } from '../../../src/modules/decision-engine/underwriting-signals.service.js';

type ComplianceSignals = { activeWatchlistMatch: boolean; openFraudCase: boolean };

function build(compliance: ComplianceSignals = { activeWatchlistMatch: false, openFraudCase: false }) {
  const signals = {
    economicAttributes: jest.fn(async (..._args: unknown[]) => ({ monthly_income_declared: 8000, monthly_expenses_declared: 3000 })),
    currentProfile: jest.fn(async (..._args: unknown[]) => ({ age: 34 })),
    contactVerification: jest.fn(async (..._args: unknown[]) => ({ emailVerified: true, phoneVerified: true })),
    hasVerifiedAddress: jest.fn(async (..._args: unknown[]) => true),
    identitySignals: jest.fn(async (..._args: unknown[]) => ({
      verified: true,
      liveness: true,
      matchScore: 90,
      confidence: 88,
      inferred: false,
    })),
    complianceSignals: jest.fn(async (..._args: unknown[]) => compliance),
  };
  const historial = {
    creditHistory: jest.fn(async (..._args: unknown[]) => ({
      monthlyCommitted: 0,
      loanCount: 0,
      delinquencyCount12m: 0,
      worstStatus: 'CURRENT',
      chargeOffCount: 0,
      oldestTradeAgeMonths: 0,
      applications6m: 0,
      applications24h: 0,
      utilization: 0,
      paymentHistoryScore: 0,
    })),
  };
  const service = new UnderwritingFeaturesService(signals as never, historial as never);
  return { service, signals };
}

const input = { tenantId: '1', customerId: 'c1', requestedAmount: 3000, requestedTermMonths: 6 };

describe('C-6 · cumplimiento: lo que no se sabe no viaja como «limpio»', () => {
  it('sin datos reales de sanciones, el payload lleva MISSING, no CLEAR', async () => {
    const { service } = build();

    const { variables, provenance } = await service.build(input);

    // Antes: `sanctions_screening_result = 'CLEAR'` para TODOS, declarado `ausente` en la procedencia
    // pero con el valor limpio en la variable: la política lo leía como «se cotejó y salió limpio».
    expect(variables.sanctions_screening_result).toBe('MISSING');
    expect(variables.sanctions_screening_result).toBe(NOT_ASSESSED);
    expect(variables.sanctions_screening_result).not.toBe('CLEAR');
    expect(variables.ofac_screening_result).toBe('MISSING');
    expect(provenance.sanctions_screening_result).toBe('ausente');
  });

  it('PEP y señal de fraude sin fuente viajan ausentes (null), no como `false`', async () => {
    const { service } = build();

    const { variables, provenance } = await service.build(input);

    expect(variables.pep_status).toBeNull();
    expect(variables.pep_status).not.toBe(false);
    expect(variables.pep_relationship_type).toBe('MISSING');
    expect(variables.pep_relationship_type).not.toBe('NONE');
    expect(variables.fraud_signal).toBeNull();
    expect(variables.fraud_signal).not.toBe(false);
    expect(provenance.pep_status).toBe('ausente');
    expect(provenance.fraud_signal).toBe('ausente');
  });

  it('una coincidencia ACTIVA con listas restrictivas SÍ es un hecho: se afirma, con procedencia de expediente', async () => {
    const { service } = build({ activeWatchlistMatch: true, openFraudCase: false });

    const { variables, provenance } = await service.build(input);

    expect(variables.sanctions_screening_result).toBe('POTENTIAL_MATCH');
    expect(provenance.sanctions_screening_result).toBe('expediente');
    // OFAC no tiene cotejo propio: una coincidencia con «listas restrictivas» no dice nada de OFAC.
    expect(variables.ofac_screening_result).toBe('MISSING');
  });

  it('un caso de fraude ABIERTO es un hecho: fraud_signal = true', async () => {
    const { service } = build({ activeWatchlistMatch: false, openFraudCase: true });

    const { variables, provenance } = await service.build(input);

    expect(variables.fraud_signal).toBe(true);
    expect(provenance.fraud_signal).toBe('expediente');
  });

  it('lo que sí se sabe sigue viajando igual', async () => {
    const { service } = build();

    const { variables } = await service.build(input);

    expect(variables).toMatchObject({
      kyc_status: 'VERIFIED',
      national_id_verified: true,
      requested_amount: 3000,
      declared_monthly_income: 8000,
    });
  });
});

describe('C-6 · la edad no se manda saltándose el gobierno de variables', () => {
  it('`age` no viaja en el payload ni en la procedencia, y ni siquiera se consulta', async () => {
    const { service, signals } = build();

    const { variables, provenance } = await service.build(input);

    // El catálogo declara `edad` prohibida para decidir crédito (SOLO_ELEGIBILIDAD_LEGAL); este
    // servicio la mandaba igual, sin pasar por el gobierno que `FeatureProjectionService` sí aplica.
    expect(variables).not.toHaveProperty('age');
    expect(provenance).not.toHaveProperty('age');
    expect(signals.currentProfile).not.toHaveBeenCalled();
  });
});

describe('UnderwritingSignalsService.complianceSignals', () => {
  /**
   * Se arma por posición, como en la prueba de señales de identidad: cada modelo que el servicio
   * sume responde vacío, y aquí sólo importan los dos de cumplimiento y fraude, que van al final.
   */
  function buildSignals(counts: { matches: number; fraud: number }) {
    const model = (count: number) => ({
      findAll: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findOne: jest.fn(async (..._args: unknown[]) => null),
      count: jest.fn(async (..._args: unknown[]) => count),
    });
    const watchlistMatches = model(counts.matches);
    const fraudCases = model(counts.fraud);
    const models = Array.from({ length: 12 }, () => model(0)) as unknown[];
    models[6] = watchlistMatches;
    models[7] = fraudCases;
    const service = new UnderwritingSignalsService(...(models as unknown as ConstructorParameters<typeof UnderwritingSignalsService>));
    return { service, watchlistMatches, fraudCases };
  }

  it('sólo afirma lo que hay: coincidencias activas y casos de fraude abiertos', async () => {
    const { service } = buildSignals({ matches: 2, fraud: 1 });

    await expect(service.complianceSignals('1', 'c1')).resolves.toEqual({ activeWatchlistMatch: true, openFraudCase: true });
  });

  it('sin filas NO devuelve «limpio»: devuelve que no hay nada que afirmar', async () => {
    const { service } = buildSignals({ matches: 0, fraud: 0 });

    await expect(service.complianceSignals('1', 'c1')).resolves.toEqual({ activeWatchlistMatch: false, openFraudCase: false });
  });

  it('cuenta las coincidencias del cliente y los casos de fraude ABIERTOS del cliente y del tenant, no los cerrados', async () => {
    const { service, fraudCases, watchlistMatches } = buildSignals({ matches: 0, fraud: 0 });

    await service.complianceSignals('1', 'c1');

    expect(watchlistMatches.count).toHaveBeenCalledWith({ where: { tenantId: '1', customerId: 'c1' } });
    const [[options]] = fraudCases.count.mock.calls as unknown as [[{ where: Record<string, unknown> }]];
    expect(options.where).toMatchObject({ tenantId: '1', customerId: 'c1', closedAt: null });
  });
});
