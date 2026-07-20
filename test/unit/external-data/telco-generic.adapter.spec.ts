import { describe, expect, it } from '@jest/globals';
import { TelcoGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/telco-generic/telco-generic.adapter.js';

/** `TelcoGenericAdapter` (confianza de teléfono). Escenario fraud_signal_high vs normal; normalize con SIM-swap. */
describe('TelcoGenericAdapter', () => {
  const adapter = new TelcoGenericAdapter();
  const local = (scenario?: string) => ({ mode: 'local', providerCode: 'TELCO_GENERIC', input: scenario ? { scenario } : {} }) as never;

  it('execute lanza en disabled; escenario high vs normal cambia el riesgo de SIM swap', async () => {
    await expect(adapter.execute({ mode: 'disabled', input: {} } as never)).rejects.toThrow('TELCO_PROVIDER_DISABLED');
    expect((await adapter.execute(local())).payload).toMatchObject({ simSwapRiskLevel: 'LOW', lineAgeBucket: 'OLD' });
    expect((await adapter.execute(local('fraud_signal_high'))).payload).toMatchObject({
      simSwapRiskLevel: 'HIGH',
      recentSimChangeDetected: true,
    });
  });

  it('normalize (LOW, score alto) verifica el owner y no exige revisión', async () => {
    const obs = await adapter.normalize({
      status: 'VERIFIED',
      payload: {
        phoneNumberActive: true,
        lineAgeDays: 720,
        lineAgeBucket: 'OLD',
        simSwapRiskLevel: 'LOW',
        ownerMatchScore: 0.9,
        manualReviewRequired: false,
      },
    } as never);
    expect(obs.find((o) => o.observationKey === 'phone_number_owner_match_score')).toMatchObject({
      valueNumber: 0.9,
      verified: true,
      manualReviewRequired: false,
    });
    expect(obs.find((o) => o.observationKey === 'phone_sim_swap_risk_level')).toMatchObject({ valueString: 'LOW' });
  });

  it('normalize (HIGH, score bajo) exige revisión manual y no verifica el owner', async () => {
    const obs = await adapter.normalize({
      status: 'VERIFIED',
      payload: { simSwapRiskLevel: 'HIGH', ownerMatchScore: 0.42, manualReviewRequired: true },
    } as never);
    expect(obs.find((o) => o.observationKey === 'phone_number_owner_match_score')).toMatchObject({
      verified: false,
      manualReviewRequired: true,
    });
    expect(obs.find((o) => o.observationKey === 'phone_sim_swap_risk_level')).toMatchObject({ manualReviewRequired: true });
  });

  it('normalize sin lineAgeDays -> STRING con DATA_NOT_AVAILABLE', async () => {
    const obs = await adapter.normalize({ status: 'VERIFIED', payload: { simSwapRiskLevel: 'LOW', ownerMatchScore: 0.8 } } as never);
    expect(obs.find((o) => o.observationKey === 'phone_line_age_days')).toMatchObject({
      valueType: 'STRING',
      valueString: 'DATA_NOT_AVAILABLE',
      verified: false,
    });
  });
});
