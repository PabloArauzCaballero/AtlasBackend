import { describe, expect, it } from '@jest/globals';
import { WhatsappAdapter } from '../../../src/modules/external-data/infrastructure/adapters/whatsapp/whatsapp.adapter.js';

/** `WhatsappAdapter` (verificación WhatsApp). Escenario not_found vs OTP_VERIFIED; normalize con umbrales. */
describe('WhatsappAdapter', () => {
  const adapter = new WhatsappAdapter();
  const local = (scenario?: string) => ({ mode: 'local', providerCode: 'WHATSAPP_GENERIC', input: scenario ? { scenario } : {} }) as never;

  it('execute lanza en disabled; OTP_VERIFIED por defecto, NOT_REACHABLE en not_found', async () => {
    await expect(adapter.execute({ mode: 'disabled', input: {} } as never)).rejects.toThrow('WHATSAPP_PROVIDER_DISABLED');
    expect((await adapter.execute(local())).status).toBe('OTP_VERIFIED');
    expect((await adapter.execute(local('not_found'))).status).toBe('NOT_REACHABLE');
  });

  it('normalize (verificado) marca reachable/otp/phone y score alto', async () => {
    const obs = await adapter.normalize({ status: 'OTP_VERIFIED', payload: { status: 'OTP_VERIFIED', whatsappReachable: true, phoneMatch: true, contactabilityScore: 0.96 } } as never);
    expect(obs.find((o) => o.observationKey === 'whatsapp_otp_verified')).toMatchObject({ valueBoolean: true, verified: true });
    expect(obs.find((o) => o.observationKey === 'whatsapp_phone_match')).toMatchObject({ verified: true, manualReviewRequired: false });
    expect(obs.find((o) => o.observationKey === 'whatsapp_contactability_score')).toMatchObject({ valueNumber: 0.96, verified: true });
  });

  it('normalize (no alcanzable, score bajo) exige revisión manual', async () => {
    const obs = await adapter.normalize({ status: 'NOT_REACHABLE', payload: { status: 'NOT_REACHABLE', whatsappReachable: false, phoneMatch: false, contactabilityScore: 0.1 } } as never);
    expect(obs.find((o) => o.observationKey === 'whatsapp_phone_match')).toMatchObject({ verified: false, manualReviewRequired: true });
    expect(obs.find((o) => o.observationKey === 'whatsapp_contactability_score')).toMatchObject({ verified: false, manualReviewRequired: true });
  });
});
