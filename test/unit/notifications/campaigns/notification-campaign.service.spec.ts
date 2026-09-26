import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { NotificationCampaignService } from '../../../../src/modules/notifications/campaigns/notification-campaign.service.js';

type Row = Record<string, unknown>;

function model(overrides: Row = {}): Row {
  return {
    id: '4',
    campaignUuid: 'u-4',
    name: 'Promo',
    purpose: 'marketing',
    status: 'draft',
    title: 'T',
    body: 'B',
    category: 'campaign',
    icon: null,
    deepLink: null,
    channels: ['in_app'],
    audienceSegmentId: null,
    audienceDefinitionJson: { match: 'all', rules: [] },
    audienceEstimateJson: null,
    startsAt: null,
    endsAt: null,
    ratePerMinute: 600,
    maxRecipients: null,
    targetedCount: 0,
    createdCount: 0,
    ...overrides,
  };
}

function build(found: Row | null = model()) {
  const repository = {
    listCampaigns: jest.fn(async (..._args: unknown[]) => ({ rows: [model()], count: 41 })),
    findCampaign: jest.fn(async (..._args: unknown[]) => found),
    findCampaignByIdempotencyKey: jest.fn(async (..._args: unknown[]): Promise<Row | null> => null),
    createCampaign: jest.fn(async (values: Row, ..._rest: unknown[]) => ({ id: '9', ...values })),
    saveCampaign: jest.fn(async (target: Row, patch: Row, ..._rest: unknown[]) => Object.assign(target, patch)),
    transition: jest.fn(async (..._args: unknown[]) => true),
    cancelPendingMessages: jest.fn(async (..._args: unknown[]) => 2),
    messageStats: jest.fn(async (..._args: unknown[]) => [{ channel: 'in_app', status: 'delivered', count: 3, read: 1 }]),
  };
  const audience = {
    resolveDefinition: jest.fn(async (..._args: unknown[]) => ({ match: 'all', rules: [] })),
    estimateDefinition: jest.fn(async (..._args: unknown[]) => ({ total: 10, withPushDevice: 4, withVerifiedEmail: 2, estimatedAt: 'x' })),
  };
  const notifications = { listMessages: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })) };
  const service = new NotificationCampaignService(repository as never, audience as never, notifications as never);
  return { service, repository, audience, notifications };
}

const dto = {
  name: 'Promo',
  purpose: 'marketing',
  title: 'T',
  body: 'B',
  category: 'campaign',
  channels: ['in_app'],
  ratePerMinute: 600,
} as never;

describe('NotificationCampaignService', () => {
  it('lista con paginación calculada', async () => {
    const { service } = build();
    expect((await service.list('1', { page: 2, limit: 20 })).pagination).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
  });

  it('crea en borrador con la audiencia resuelta; la misma clave devuelve la misma campaña', async () => {
    const { service, repository } = build();
    const created = await service.create('1', 'u1', dto, 'idem-1');
    expect(created).toMatchObject({ status: 'draft', createdBy: 'u1' });
    expect(repository.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', idempotencyKey: 'idem-1', createdBy: 'u1' }),
    );
    repository.findCampaignByIdempotencyKey.mockResolvedValueOnce(model({ id: '77' }));
    expect((await service.create('1', 'u1', dto, 'idem-1')).id).toBe('77');
  });

  it('una carrera por la clave de idempotencia devuelve la ganadora', async () => {
    const { service, repository } = build();
    repository.createCampaign.mockRejectedValueOnce(new UniqueConstraintError({}) as never);
    repository.findCampaignByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(model({ id: '88' }));
    expect((await service.create('1', 'u1', dto, 'idem-2')).id).toBe('88');
  });

  it('no deja editar una campaña en curso, y editar una programada la devuelve a borrador', async () => {
    await expect(build(model({ status: 'running' })).service.update('1', '4', { title: 'x' })).rejects.toBeInstanceOf(ConflictException);
    const scheduled = model({ status: 'scheduled' });
    const { service } = build(scheduled);
    await service.update('1', '4', { title: 'Nuevo', audience: { match: 'all', rules: [] } });
    expect(scheduled).toMatchObject({ title: 'Nuevo', status: 'draft', scheduledAt: null });
  });

  it('rechaza una ventana invertida al editar', async () => {
    const { service } = build(model({ startsAt: new Date('2026-09-20T10:00:00Z') }));
    await expect(service.update('1', '4', { endsAt: new Date('2026-09-20T09:00:00Z') })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('programar exige audiencia no vacía, inicio no pasado y fin posterior', async () => {
    const empty = build();
    empty.audience.estimateDefinition.mockResolvedValueOnce({ total: 0, withPushDevice: 0, withVerifiedEmail: 0, estimatedAt: 'x' });
    await expect(empty.service.schedule('1', '4', 'u1')).rejects.toThrow('NOTIFICATION_CAMPAIGN_AUDIENCE_EMPTY');
    await expect(build(model({ startsAt: new Date(Date.now() - 3_600_000) })).service.schedule('1', '4', 'u1')).rejects.toThrow(
      'START_IN_PAST',
    );
    await expect(build(model({ endsAt: new Date(Date.now() - 60_000) })).service.schedule('1', '4', 'u1')).rejects.toThrow(
      'ENDS_BEFORE_START',
    );
  });

  it('programa congelando la estimación; si otro proceso la movió, conflicto', async () => {
    const { service, repository } = build();
    await service.schedule('1', '4', 'u1');
    expect(repository.transition).toHaveBeenCalledWith(
      '4',
      ['draft'],
      expect.objectContaining({ status: 'scheduled', scheduledBy: 'u1', audienceEstimateJson: expect.objectContaining({ total: 10 }) }),
    );
    repository.transition.mockResolvedValueOnce(false);
    await expect(service.schedule('1', '4', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('pausa, reanuda y desprograma sólo desde su estado', async () => {
    await expect(build(model({ status: 'draft' })).service.pause('1', '4')).rejects.toBeInstanceOf(ConflictException);
    const running = build(model({ status: 'running' }));
    await running.service.pause('1', '4');
    expect(running.repository.transition).toHaveBeenCalledWith('4', ['running'], expect.objectContaining({ status: 'paused' }));
    const paused = build(model({ status: 'paused' }));
    await paused.service.resume('1', '4');
    expect(paused.repository.transition).toHaveBeenCalledWith('4', ['paused'], { status: 'running', pausedAt: null });
    const scheduled = build(model({ status: 'scheduled' }));
    await scheduled.service.unschedule('1', '4');
    expect(scheduled.repository.transition).toHaveBeenCalledWith('4', ['scheduled'], expect.objectContaining({ status: 'draft' }));
  });

  it('cancelar anula lo pendiente; una terminada no se cancela', async () => {
    const { service, repository } = build(model({ status: 'running' }));
    const result = await service.cancel('1', '4', { reason: 'Error en el texto' });
    expect(repository.cancelPendingMessages).toHaveBeenCalledWith('4', expect.any(Date));
    expect(result.metrics).toMatchObject({ totals: { delivered: 3, read: 1 } });
    await expect(build(model({ status: 'completed' })).service.cancel('1', '4', { reason: 'Error en el texto' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('duplica como borrador nuevo y lista los avisos por su correlación', async () => {
    const { service, repository, notifications } = build();
    await service.duplicate('1', '4', 'u1', 'idem-3');
    expect(repository.createCampaign).toHaveBeenCalledWith(expect.objectContaining({ name: 'Promo (copia)', status: 'draft' }));
    await service.listMessages('1', '4', { page: 1, limit: 10 });
    expect(notifications.listMessages).toHaveBeenCalledWith('1', expect.objectContaining({ correlationId: 'campaign:u-4' }));
  });

  it('una campaña inexistente es 404', async () => {
    await expect(build(null).service.get('1', '4')).rejects.toBeInstanceOf(NotFoundException);
  });
});
