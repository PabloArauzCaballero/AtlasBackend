import { describe, expect, it } from '@jest/globals';
import {
  buildCampaignMessageRows,
  campaignCorrelationId,
  campaignPayload,
  channelsForMember,
  scheduledSlot,
  testCorrelationId,
} from '../../../../src/modules/notifications/campaigns/notification-campaign-messages.js';

const campaign = (overrides: Record<string, unknown> = {}) =>
  ({
    id: '9',
    tenantId: '1',
    campaignUuid: 'uuid-1',
    title: 'Tu cuota vence',
    body: 'Paga antes del viernes',
    category: 'campaign',
    icon: null,
    deepLink: '/pagos',
    channels: ['in_app', 'push', 'email'],
    ratePerMinute: 2,
    startsAt: null,
    endsAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  }) as never;

describe('avisos de campaña', () => {
  it('cada persona recibe sólo los canales que puede recibir', () => {
    expect(channelsForMember(['in_app', 'push', 'email'], { customerId: '1', hasPushDevice: false, hasVerifiedEmail: true })).toEqual([
      'in_app',
      'email',
    ]);
    expect(channelsForMember(['push'], { customerId: '1', hasPushDevice: false, hasVerifiedEmail: false })).toEqual([]);
  });

  it('la cadencia escalona por minuto', () => {
    const start = new Date('2026-09-20T09:00:00Z');
    expect(scheduledSlot(start, 1, 2).toISOString()).toBe('2026-09-20T09:00:00.000Z');
    expect(scheduledSlot(start, 2, 2).toISOString()).toBe('2026-09-20T09:01:00.000Z');
    expect(scheduledSlot(start, 5, 0).toISOString()).toBe('2026-09-20T09:05:00.000Z');
  });

  it('el payload lleva la campaña y el enlace; sin enlace no inventa uno', () => {
    expect(campaignPayload({ campaignUuid: 'u', deepLink: '/pagos' })).toMatchObject({
      visible: true,
      pushData: { campaignId: 'u', deepLink: '/pagos' },
    });
    expect(campaignPayload({ campaignUuid: 'u', deepLink: null }).pushData).toEqual({ campaignId: 'u' });
  });

  it('las filas llevan campaña, vigencia, asunto sólo en correo, y arrancan ahora si el inicio ya pasó', () => {
    const now = new Date('2026-09-20T10:00:00Z');
    const rows = buildCampaignMessageRows(campaign(), [{ customerId: '5', hasPushDevice: true, hasVerifiedEmail: true }], 0, now);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.channel)).toEqual(['in_app', 'push', 'email']);
    expect(rows.find((row) => row.channel === 'email')?.subject).toBe('Tu cuota vence');
    expect(rows.find((row) => row.channel === 'push')?.subject).toBeNull();
    expect(rows[0]).toMatchObject({
      campaignId: '9',
      status: 'pending',
      correlationId: campaignCorrelationId('uuid-1'),
      expiresAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(rows[0].scheduledAt).toEqual(now);
  });

  it('un inicio futuro se respeta, y la prueba no cuenta en la campaña', () => {
    const now = new Date('2026-09-20T10:00:00Z');
    const future = new Date('2026-09-21T09:00:00Z');
    const rows = buildCampaignMessageRows(
      campaign({ startsAt: future }),
      [{ customerId: '5', hasPushDevice: false, hasVerifiedEmail: false }],
      4,
      now,
      testCorrelationId('uuid-1'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledAt).toEqual(new Date('2026-09-21T09:02:00Z'));
    expect(rows[0].campaignId).toBeNull();
  });
});
