import { describe, expect, it, jest } from '@jest/globals';
import { NotificationTemplatesService } from '../../../src/modules/notifications/notification-templates.service.js';

describe('NotificationTemplatesService', () => {
  function build() {
    const templates = {
      listTemplates: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 21 })),
      createTemplate: jest.fn(async (..._args: unknown[]) => ({ id: 2, code: 'C' })),
      updateTemplate: jest.fn(async (..._args: unknown[]) => ({ id: 2, code: 'C' })),
    };
    return { service: new NotificationTemplatesService(templates as never), templates };
  }

  it('listTemplates pagina con totalPages = ceil(total/limit)', async () => {
    const { service, templates } = build();
    const res = await service.listTemplates('1', { page: 1, limit: 10 } as never);
    expect(templates.listTemplates).toHaveBeenCalledTimes(1);
    expect(res.pagination).toMatchObject({ total: 21, totalPages: 3 });
  });

  it('createTemplate y updateTemplate delegan y mapean', async () => {
    const { service, templates } = build();
    await service.createTemplate('1', { code: 'C' } as never);
    await service.updateTemplate('1', 't1', { code: 'C' } as never);
    expect(templates.createTemplate).toHaveBeenCalledTimes(1);
    expect(templates.updateTemplate).toHaveBeenCalledTimes(1);
  });
});
