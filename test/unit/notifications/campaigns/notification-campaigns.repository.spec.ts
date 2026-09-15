import { describe, expect, it, jest } from '@jest/globals';
import { NotificationCampaignsRepository } from '../../../../src/modules/notifications/campaigns/notification-campaigns.repository.js';

type Row = Record<string, unknown>;

function build() {
  const campaigns = {
    create: jest.fn(async (values: Row, ..._rest: unknown[]) => values),
    findOne: jest.fn(async (..._args: unknown[]) => null),
    findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
    update: jest.fn(async (..._args: unknown[]) => [1]),
    findAll: jest.fn(async (..._args: unknown[]) => []),
  };
  const segments = {
    create: jest.fn(async (values: Row, ..._rest: unknown[]) => values),
    findOne: jest.fn(async (..._args: unknown[]) => null),
    findAll: jest.fn(async (..._args: unknown[]) => []),
  };
  const query = jest.fn(async (..._args: unknown[]) => [{ channel: 'push', status: 'failed', count: '2', read: '0' }]);
  const messages = {
    bulkCreate: jest.fn(async (rows: Row[], ..._rest: unknown[]) =>
      rows.map((_row, index) => ({ id: index === 0 ? null : String(index) })),
    ),
    findAll: jest.fn(async (..._args: unknown[]) => []),
    count: jest.fn(async (..._args: unknown[]) => 4),
    update: jest.fn(async (..._args: unknown[]) => [3]),
    sequelize: { query },
  };
  const repository = new NotificationCampaignsRepository(campaigns as never, segments as never, messages as never);
  return { repository, campaigns, segments, messages, query };
}

describe('NotificationCampaignsRepository', () => {
  it('sella fechas al crear y consulta por tenant', async () => {
    const { repository, campaigns, segments } = build();
    expect(await repository.createCampaign({ name: 'x' })).toHaveProperty('createdAtValue');
    expect(await repository.createSegment({ name: 'y' })).toHaveProperty('updatedAtValue');
    await repository.findCampaign('1', '2');
    await repository.findCampaignByIdempotencyKey('1', 'k');
    await repository.findSegment('1', '3');
    await repository.listSegments('1', 'active');
    expect(campaigns.findOne).toHaveBeenCalledWith({ where: { tenantId: '1', id: '2' } });
    expect(segments.findAll).toHaveBeenCalledWith({ where: { tenantId: '1', status: 'active' }, order: [['name', 'ASC']] });
  });

  it('lista con búsqueda y paginación por offset', async () => {
    const { repository, campaigns } = build();
    await repository.listCampaigns('1', { page: 3, limit: 10, status: 'running', search: 'cuota' });
    expect(campaigns.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ offset: 20, limit: 10 }));
  });

  it('la transición es condicional y dice si aplicó', async () => {
    const { repository, campaigns } = build();
    expect(await repository.transition('5', ['draft'], { status: 'scheduled' })).toBe(true);
    campaigns.update.mockResolvedValueOnce([0] as never);
    expect(await repository.transition('5', ['draft'], { status: 'scheduled' })).toBe(false);
  });

  it('cuenta sólo los avisos realmente insertados (los duplicados vuelven sin id)', async () => {
    const { repository, messages } = build();
    expect(await repository.insertCampaignMessages([{ a: 1 }, { a: 2 }, { a: 3 }])).toBe(2);
    expect(messages.bulkCreate).toHaveBeenCalledWith(expect.any(Array), { ignoreDuplicates: true, returning: ['id'] });
    expect(await repository.insertCampaignMessages([])).toBe(0);
  });

  it('selecciona, cuenta, anula y agrega los avisos de la campaña', async () => {
    const { repository, query } = build();
    await repository.listDueToStart('1', new Date(), 5);
    await repository.listRunning('1', 5);
    await repository.listDeliverableMessages('5', new Date(), 10);
    expect(await repository.countUndelivered('5')).toBe(4);
    expect(await repository.cancelPendingMessages('5', new Date())).toBe(3);
    expect(await repository.messageStats('5')).toEqual([{ channel: 'push', status: 'failed', count: 2, read: 0 }]);
    expect(String((query.mock.calls[0] as unknown[])[0])).toContain('messaging.notification_messages');
  });

  it('guarda con marca de actualización', async () => {
    const { repository } = build();
    const target = { set: jest.fn(), save: jest.fn(async (..._args: unknown[]) => 'saved') };
    expect(await repository.saveCampaign(target as never, { a: 1 })).toBe('saved');
    expect(await repository.saveSegment(target as never, { b: 2 })).toBe('saved');
    expect(target.set).toHaveBeenCalledWith(expect.objectContaining({ a: 1, updatedAtValue: expect.any(Date) }));
  });

  it('sin conexión las métricas son vacías', async () => {
    const campaigns = {};
    const repository = new NotificationCampaignsRepository(campaigns as never, {} as never, { sequelize: null } as never);
    expect(await repository.messageStats('1')).toEqual([]);
  });
});
