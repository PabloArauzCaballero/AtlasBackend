import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { extraPushData, wantsVisiblePush } from '../../../../src/modules/notifications/adapters/push-payload.util.js';
import { NotificationCampaignTestSendService } from '../../../../src/modules/notifications/campaigns/notification-campaign-test-send.service.js';
import { mapCampaign, mapSegment, summarizeStats } from '../../../../src/modules/notifications/campaigns/notification-campaigns.mapper.js';
import { notExpired, ownedByGenericJobs } from '../../../../src/modules/notifications/campaigns/notification-visibility.util.js';

describe('push de campaña', () => {
  it('sólo viajan pares texto→texto, sin pisar las claves reservadas', () => {
    expect(extraPushData({ pushData: { deepLink: '/pagos', channel: 'hack', n: 3, empty: '' } })).toEqual({ deepLink: '/pagos' });
    expect(extraPushData({ pushData: ['x'] })).toEqual({});
    expect(extraPushData(null)).toEqual({});
    expect(wantsVisiblePush({ visible: true })).toBe(true);
    expect(wantsVisiblePush({ visible: 'true' })).toBe(false);
  });
});

describe('filtros de visibilidad', () => {
  it('la bandeja oculta lo vencido y los jobs genéricos no tocan avisos de campaña ni programados', () => {
    const now = new Date('2026-09-20T00:00:00Z');
    const [clause] = notExpired(now)[Op.and as unknown as symbol] as Array<Record<symbol, Array<Record<string, unknown>>>>;
    const alternatives = clause[Op.or as unknown as symbol];
    expect(alternatives[0]).toEqual({ expiresAt: null });
    expect((alternatives[1].expiresAt as Record<symbol, unknown>)[Op.gt as unknown as symbol]).toBe(now);
    const owned = ownedByGenericJobs(now);
    expect(owned.campaignId).toBeNull();
    expect(owned[Op.or as unknown as symbol]).toHaveLength(2);
  });
});

describe('mapper de campañas', () => {
  it('resume por canal: entregados incluye leídos, lo demás pendiente', () => {
    const summary = summarizeStats([
      { channel: 'push', status: 'delivered', count: 4, read: 0 },
      { channel: 'push', status: 'failed', count: 1, read: 0 },
      { channel: 'in_app', status: 'read', count: 2, read: 2 },
      { channel: 'in_app', status: 'pending', count: 5, read: 0 },
      { channel: 'in_app', status: 'cancelled', count: 1, read: 0 },
    ]);
    expect(summary.totals).toEqual({ total: 13, pending: 5, delivered: 6, failed: 1, cancelled: 1, read: 2 });
    expect(summary.channels.map((entry) => entry.channel)).toEqual(['in_app', 'push']);
  });

  it('mapea identificadores a texto y sólo incluye métricas cuando se piden', () => {
    const base = { id: 7, audienceSegmentId: 3, createdAtValue: 'c', updatedAtValue: 'u' } as never;
    expect(mapCampaign(base)).toMatchObject({ id: '7', audienceSegmentId: '3' });
    expect(mapCampaign(base)).not.toHaveProperty('metrics');
    expect(mapCampaign({ ...(base as object), audienceSegmentId: null } as never, [])).toMatchObject({
      audienceSegmentId: null,
      metrics: { totals: { total: 0 } },
    });
    expect(mapSegment({ id: 2, name: 'S' } as never)).toMatchObject({ id: '2', name: 'S' });
  });
});

describe('NotificationCampaignTestSendService', () => {
  function build(channels: string[]) {
    const campaign = {
      id: '4',
      tenantId: '1',
      campaignUuid: 'u-4',
      title: 'Hola',
      body: 'B',
      category: 'c',
      icon: null,
      deepLink: null,
      channels,
      ratePerMinute: 600,
      startsAt: null,
      endsAt: null,
    };
    const campaigns = { load: jest.fn(async () => campaign) };
    const repository = { insertCampaignMessages: jest.fn(async (rows: unknown[]) => rows.length) };
    const created = channels.map((channel, index) => ({ id: String(index + 1), channel, status: 'pending' }));
    const notifications = {
      listMessages: jest.fn(async (..._args: unknown[]) => ({ rows: created, count: created.length })),
      getMessage: jest.fn(async (_tenant: string, id: string) => ({
        id,
        channel: created[Number(id) - 1].channel,
        status: id === '1' ? 'delivered' : 'failed',
      })),
      listDeliveries: jest.fn(async (_tenant: string, id: string) =>
        id === '2' ? [{ errorCode: 'MISSING_FCM_TOKENS', errorMessage: 'sin tokens' }] : [],
      ),
    };
    const orchestrator = { deliverMessage: jest.fn(async (..._args: unknown[]) => undefined) };
    const service = new NotificationCampaignTestSendService(
      campaigns as never,
      repository as never,
      notifications as never,
      orchestrator as never,
    );
    return { service, repository, orchestrator };
  }

  it('entrega a un cliente por cada canal y dice cómo quedó cada uno', async () => {
    const { service, repository, orchestrator } = build(['in_app', 'push']);
    const result = await service.send('1', '4', { customerId: '55' });
    const rows = repository.insertCampaignMessages.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.every((row) => row.campaignId === null && String(row.title).startsWith('[PRUEBA]'))).toBe(true);
    expect(orchestrator.deliverMessage).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([
      { channel: 'in_app', status: 'delivered', messageId: '1', errorCode: null, errorMessage: null },
      { channel: 'push', status: 'failed', messageId: '2', errorCode: 'MISSING_FCM_TOKENS', errorMessage: 'sin tokens' },
    ]);
  });

  it('sin canales no hay nada que probar', async () => {
    await expect(build([]).service.send('1', '4', { customerId: '55' })).rejects.toThrow('NOTIFICATION_CAMPAIGN_NO_CHANNELS');
  });
});
