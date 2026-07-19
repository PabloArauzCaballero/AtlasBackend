import { describe, expect, it } from '@jest/globals';
import { DigitalTrustGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/digital-trust-generic/digital-trust-generic.adapter.js';

/** `DigitalTrustGenericAdapter` (email/IP/dispositivo). Escenario high vs low; normalize con umbrales de riesgo. */
describe('DigitalTrustGenericAdapter', () => {
  const adapter = new DigitalTrustGenericAdapter();
  const local = (scenario?: string) => ({ mode: 'local', providerCode: 'DIGITAL_TRUST_GENERIC', input: scenario ? { scenario } : {} }) as never;

  it('execute lanza en disabled; high vs normal cambia los scores de riesgo', async () => {
    await expect(adapter.execute({ mode: 'disabled', input: {} } as never)).rejects.toThrow('DIGITAL_TRUST_PROVIDER_DISABLED');
    expect((await adapter.execute(local())).payload).toMatchObject({ syntheticIdentityRiskLevel: 'LOW', deviceRiskScore: 0.15 });
    expect((await adapter.execute(local('fraud_signal_high'))).payload).toMatchObject({ syntheticIdentityRiskLevel: 'HIGH', deviceRiskScore: 0.78 });
  });

  it('normalize (riesgo alto) exige revisión en device/ip/synthetic sobre el umbral', async () => {
    const obs = await adapter.normalize({ status: 'COMPLETED', payload: { emailRiskLevel: 'HIGH', deviceRiskScore: 0.78, ipRiskScore: 0.84, syntheticIdentityRiskLevel: 'HIGH' } } as never);
    expect(obs.find((o) => o.observationKey === 'device_reputation_score')).toMatchObject({ manualReviewRequired: true });
    expect(obs.find((o) => o.observationKey === 'ip_risk_score')).toMatchObject({ manualReviewRequired: true });
    expect(obs.find((o) => o.observationKey === 'synthetic_identity_risk_level')).toMatchObject({ manualReviewRequired: true, verified: true });
    expect(obs.find((o) => o.observationKey === 'email_domain_risk_level')).toMatchObject({ manualReviewRequired: true });
  });

  it('normalize (riesgo bajo) no exige revisión', async () => {
    const obs = await adapter.normalize({ status: 'COMPLETED', payload: { emailRiskLevel: 'LOW', deviceRiskScore: 0.15, ipRiskScore: 0.18, syntheticIdentityRiskLevel: 'LOW' } } as never);
    expect(obs.find((o) => o.observationKey === 'device_reputation_score')).toMatchObject({ manualReviewRequired: false });
    expect(obs.find((o) => o.observationKey === 'synthetic_identity_risk_level')).toMatchObject({ manualReviewRequired: false });
  });
});
