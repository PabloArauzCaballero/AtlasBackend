import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { NotificationCampaignAudienceService } from '../../../../src/modules/notifications/campaigns/notification-campaign-audience.service.js';

type Row = Record<string, unknown>;
const definition = { match: 'all', rules: [{ attribute: 'city', operator: 'eq', value: 'La Paz' }] } as never;

function build(segment: Row | null = { id: '2', status: 'active', definitionJson: definition }) {
  const repository = {
    findSegment: jest.fn(async (..._args: unknown[]) => segment),
    listSegments: jest.fn(async (..._args: unknown[]) => [{ id: '2', name: 'Seg', status: 'active', definitionJson: definition }]),
    createSegment: jest.fn(async (values: Row, ..._rest: unknown[]) => ({ id: '5', ...values })),
    saveSegment: jest.fn(async (target: Row, patch: Row, ..._rest: unknown[]) => Object.assign(target, patch)),
  };
  const port = {
    estimate: jest.fn(async (..._args: unknown[]) => ({ total: 3, withPushDevice: 1, withVerifiedEmail: 0, estimatedAt: 'x' })),
    listMembers: jest.fn(),
  };
  return { service: new NotificationCampaignAudienceService(repository as never, port as never), repository, port };
}

describe('NotificationCampaignAudienceService', () => {
  it('usa el segmento guardado; uno archivado o inexistente es 404; sin nada, todos', async () => {
    expect(await build().service.resolveDefinition('1', { audienceSegmentId: '2' })).toBe(definition);
    await expect(
      build({ id: '2', status: 'archived', definitionJson: definition }).service.resolveDefinition('1', { audienceSegmentId: '2' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await build(null).service.resolveDefinition('1', {})).toEqual({ match: 'all', rules: [] });
  });

  it('marketing pide consentimiento; operacional no', async () => {
    const { service, port } = build();
    const result = await service.estimate('1', { purpose: 'operational', audience: definition });
    expect(port.estimate).toHaveBeenCalledWith('1', definition, { requireMarketingConsent: false });
    expect(result).toMatchObject({ total: 3, requiresMarketingConsent: false });
    await service.estimate('1', { purpose: 'marketing' });
    expect(port.estimate).toHaveBeenLastCalledWith('1', { match: 'all', rules: [] }, { requireMarketingConsent: true });
  });

  it('guarda segmentos con su tamaño y traduce el nombre repetido a 409', async () => {
    const { service, repository, port } = build();
    const created = await service.createSegment('1', 'u1', { name: 'Seg', definition });
    expect(created).toMatchObject({ id: '5', status: 'active' });
    // El tamaño guardado es el bruto: un segmento sirve a campañas de los dos tipos y guardar la
    // cifra comercial dejaba «todos los clientes activos» en 0 personas.
    expect(port.estimate).toHaveBeenCalledWith('1', definition, { requireMarketingConsent: false });
    repository.createSegment.mockRejectedValueOnce(new UniqueConstraintError({}) as never);
    await expect(service.createSegment('1', 'u1', { name: 'Seg', definition })).rejects.toBeInstanceOf(ConflictException);
    expect((await service.listSegments('1', 'active')).data).toHaveLength(1);
  });

  it('editar la definición recalcula el tamaño; archivar no', async () => {
    const segment: Row = { id: '2', status: 'active', definitionJson: definition };
    const { service, port } = build(segment);
    await service.updateSegment('1', '2', { status: 'archived', name: 'Otro', description: null });
    expect(port.estimate).not.toHaveBeenCalled();
    await service.updateSegment('1', '2', { definition });
    expect(port.estimate).toHaveBeenCalledTimes(1);
    expect(segment.lastEstimateJson).toMatchObject({ total: 3 });
    await expect(build(null).service.updateSegment('1', '9', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un nombre repetido al editar también es 409', async () => {
    const { service, repository } = build();
    repository.saveSegment.mockRejectedValueOnce(new UniqueConstraintError({}) as never);
    await expect(service.updateSegment('1', '2', { name: 'Dup' })).rejects.toBeInstanceOf(ConflictException);
  });
});
