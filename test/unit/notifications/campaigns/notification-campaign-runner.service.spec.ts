import { describe, expect, it, jest } from '@jest/globals';
import {
  MATERIALIZE_BATCH,
  NotificationCampaignRunnerService,
} from '../../../../src/modules/notifications/campaigns/notification-campaign-runner.service.js';

type Row = Record<string, unknown>;

function campaign(overrides: Row = {}): Row {
  return {
    id: '3',
    tenantId: '1',
    campaignUuid: 'u-3',
    purpose: 'marketing',
    status: 'running',
    title: 'T',
    body: 'B',
    category: 'campaign',
    icon: null,
    deepLink: null,
    channels: ['in_app', 'push'],
    audienceDefinitionJson: { match: 'all', rules: [] },
    audienceCursor: null,
    startsAt: null,
    endsAt: null,
    ratePerMinute: 600,
    maxRecipients: null,
    targetedCount: 0,
    createdCount: 0,
    materializedAt: null,
    ...overrides,
  };
}

function build(options: { due?: Row[]; running?: Row[]; members?: Row[]; deliverable?: Row[]; undelivered?: number } = {}) {
  const repository = {
    listDueToStart: jest.fn(async (..._args: unknown[]) => options.due ?? []),
    listRunning: jest.fn(async (..._args: unknown[]) => options.running ?? []),
    transition: jest.fn(async (..._args: unknown[]) => true),
    insertCampaignMessages: jest.fn(async (rows: Row[], ..._rest: unknown[]) => rows.length),
    saveCampaign: jest.fn(async (target: Row, patch: Row, ..._rest: unknown[]) => Object.assign(target, patch)),
    listDeliverableMessages: jest.fn(async (..._args: unknown[]) => options.deliverable ?? []),
    countUndelivered: jest.fn(async (..._args: unknown[]) => options.undelivered ?? 0),
    cancelPendingMessages: jest.fn(async (..._args: unknown[]) => 0),
  };
  const orchestrator = { deliverMessage: jest.fn(async (..._args: unknown[]) => undefined) };
  const audience = { estimate: jest.fn(), listMembers: jest.fn(async (..._args: unknown[]) => options.members ?? []) };
  const runner = new NotificationCampaignRunnerService(repository as never, orchestrator as never, audience as never);
  return { runner, repository, orchestrator, audience };
}

describe('NotificationCampaignRunnerService', () => {
  const now = new Date('2026-09-20T09:00:00Z');

  it('arranca las programadas que vencen con una transición condicional', async () => {
    const { runner, repository } = build({ due: [campaign({ status: 'scheduled' })] });
    const result = await runner.tick('1', now);
    expect(repository.transition).toHaveBeenCalledWith('3', ['scheduled'], { status: 'running', startedAt: now });
    expect(result.started).toBe(1);
  });

  it('materializa una tanda, avanza el cursor y la cierra si la audiencia se agotó', async () => {
    const running = campaign();
    const { runner, repository, audience } = build({
      running: [running],
      members: [
        { customerId: '10', hasPushDevice: true, hasVerifiedEmail: false },
        { customerId: '11', hasPushDevice: false, hasVerifiedEmail: false },
      ],
      undelivered: 3,
    });
    const result = await runner.tick('1', now);
    expect(audience.listMembers).toHaveBeenCalledWith(
      '1',
      running.audienceDefinitionJson,
      { requireMarketingConsent: true },
      { afterCustomerId: null, limit: MATERIALIZE_BATCH },
    );
    expect((repository.insertCampaignMessages.mock.calls[0][0] as Row[]).map((row) => `${row.recipientId}:${row.channel}`)).toEqual([
      '10:in_app',
      '10:push',
      '11:in_app',
    ]);
    expect(running).toMatchObject({ audienceCursor: '11', targetedCount: 2, createdCount: 3, materializedAt: now });
    expect(result.materialized).toBe(2);
    expect(result.completed).toBe(0);
  });

  it('respeta el tope de destinatarios sin volver a consultar la audiencia', async () => {
    const running = campaign({ maxRecipients: 5, targetedCount: 5, purpose: 'operational' });
    const { runner, audience } = build({ running: [running] });
    await runner.tick('1', now);
    expect(audience.listMembers).not.toHaveBeenCalled();
    expect(running.materializedAt).toBe(now);
  });

  it('entrega lo vencido, cuenta fallos y completa cuando no queda nada por salir', async () => {
    const { runner, orchestrator } = build({
      running: [campaign({ materializedAt: new Date('2026-09-20T08:00:00Z') })],
      deliverable: [{ id: 'm1' }, { id: 'm2' }],
      undelivered: 0,
    });
    orchestrator.deliverMessage.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const result = await runner.tick('1', now);
    expect(result).toMatchObject({ delivered: 1, failed: 1, completed: 1 });
  });

  it('una campaña vencida anula lo pendiente y se cierra sin entregar', async () => {
    const { runner, repository, orchestrator } = build({
      running: [campaign({ endsAt: new Date('2026-09-20T08:59:00Z') })],
      deliverable: [{ id: 'm1' }],
    });
    const result = await runner.tick('1', now);
    expect(repository.cancelPendingMessages).toHaveBeenCalledWith('3', now);
    expect(orchestrator.deliverMessage).not.toHaveBeenCalled();
    expect(result.completed).toBe(1);
  });

  it('si la audiencia revienta, la campaña queda fallida con el motivo', async () => {
    const { runner, repository, audience } = build({ running: [campaign()] });
    audience.listMembers.mockImplementationOnce(async () => {
      throw new Error('AUDIENCE_RULE_UNSUPPORTED: city gte');
    });
    await runner.tick('1', now);
    expect(repository.transition).toHaveBeenCalledWith(
      '3',
      ['running'],
      expect.objectContaining({ status: 'failed', lastError: 'AUDIENCE_RULE_UNSUPPORTED: city gte' }),
    );
  });
});
