import { describe, expect, it } from '@jest/globals';
import { toStartSessionResponse } from '../../../src/modules/sessions/sessions.mapper.js';

/** `toStartSessionResponse`: normaliza ids y aplica defaults (sessionStatus 'active', trustLevel 'new'). */
describe('sessions.mapper', () => {
  const base = {
    customerId: '9',
    session: { id: 1, sessionStatus: 'active' },
    device: { id: 2 },
    gps: { gpsObservationId: 'g1', gpsObservationCreated: true, gpsObservationSkippedReason: null },
    nextStep: 'home',
  };

  it('mapea con link presente (usa su trustLevel)', () => {
    const res = toStartSessionResponse({ ...base, link: { trustLevel: 'trusted' } } as never);
    expect(res).toMatchObject({
      customerId: '9',
      sessionId: '1',
      deviceId: '2',
      sessionStatus: 'active',
      deviceTrustLevel: 'trusted',
      nextStep: 'home',
    });
  });

  it('aplica defaults cuando falta link (trustLevel new) y sessionStatus null (active)', () => {
    const res = toStartSessionResponse({ ...base, session: { id: 1, sessionStatus: null }, link: null } as never);
    expect(res.deviceTrustLevel).toBe('new');
    expect(res.sessionStatus).toBe('active');
  });
});
