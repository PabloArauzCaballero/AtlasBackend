import { describe, expect, it } from '@jest/globals';
import { FacebookMetaAdapter } from '../../../src/modules/external-data/infrastructure/adapters/facebook-meta/facebook-meta.adapter.js';

/** `FacebookMetaAdapter` (señal social). normalize con umbrales de name-match y datos ausentes (email/edad). */
describe('FacebookMetaAdapter', () => {
  const adapter = new FacebookMetaAdapter();
  const local = (scenario?: string) => ({ mode: 'local', providerCode: 'FACEBOOK_META', input: scenario ? { scenario } : {} }) as never;

  it('execute lanza en disabled; en local reporta CONNECTED', async () => {
    await expect(adapter.execute({ mode: 'disabled', input: {} } as never)).rejects.toThrow('FACEBOOK_PROVIDER_DISABLED');
    expect((await adapter.execute(local())).status).toBe('CONNECTED');
    expect((await adapter.execute(local('data_not_available'))).payload).toMatchObject({ nameMatchScore: 0.91 });
  });

  it('normalize: score alto verifica; email presente BOOLEAN; edad no disponible -> STRING', async () => {
    const obs = await adapter.normalize({ status: 'CONNECTED', payload: { status: 'CONNECTED', nameMatchScore: 0.93, emailMatch: true, accountAgeAvailable: false, accountAgeDays: null } } as never);
    expect(obs.find((o) => o.observationKey === 'facebook_name_match_score')).toMatchObject({ verified: true, manualReviewRequired: false });
    expect(obs.find((o) => o.observationKey === 'facebook_email_match')).toMatchObject({ valueType: 'BOOLEAN', valueBoolean: true });
    expect(obs.find((o) => o.observationKey === 'facebook_account_age_days')).toMatchObject({ valueType: 'STRING', valueString: 'DATA_NOT_AVAILABLE', verified: false });
  });

  it('normalize: score bajo exige revisión y email ausente -> STRING', async () => {
    const obs = await adapter.normalize({ status: 'CONNECTED', payload: { status: 'CONNECTED', nameMatchScore: 0.5 } } as never);
    expect(obs.find((o) => o.observationKey === 'facebook_name_match_score')).toMatchObject({ verified: false, manualReviewRequired: true });
    expect(obs.find((o) => o.observationKey === 'facebook_email_match')).toMatchObject({ valueType: 'STRING', valueString: 'DATA_NOT_AVAILABLE' });
  });
});
