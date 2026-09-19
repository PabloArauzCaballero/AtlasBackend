import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';
import { NotificationTemplatesRepository } from '../../../src/modules/notifications/notification-templates.repository.js';

/**
 * Cobertura directa de `NotificationTemplatesRepository` (Fase 1.2/2.3 del plan 10/10): resolución de
 * plantilla (tenant → global), listado (Op.or tenant/null + filtros), y create/update con la rama
 * NotFound. Modelo Sequelize mockeado.
 */
describe('NotificationTemplatesRepository', () => {
  function buildRepo() {
    const templateModel = { findOne: asyncMock(), findAndCountAll: asyncMock(), create: asyncMock() };
    const repo = new NotificationTemplatesRepository(templateModel as never);
    return { repo, templateModel };
  }

  it('findTemplate usa el default locale es-BO y prioriza la plantilla del tenant', async () => {
    const { repo, templateModel } = buildRepo();
    (templateModel.findOne as jest.Mock).mockResolvedValue({ id: 'tpl-tenant' } as never);
    const result = await repo.findTemplate({ tenantId: 't1', code: 'welcome', channel: 'push' as never });
    expect(result).toEqual({ id: 'tpl-tenant' });
    expect(callArg<CallArgRecord>(templateModel.findOne, 0, 0).where).toMatchObject({ tenantId: 't1', locale: 'es-BO', isActive: true });
    // No cae a global porque encontró la del tenant.
    expect(templateModel.findOne).toHaveBeenCalledTimes(1);
  });

  it('findTemplate cae a la plantilla global cuando no hay del tenant', async () => {
    const { repo, templateModel } = buildRepo();
    (templateModel.findOne as jest.Mock).mockResolvedValueOnce(null as never).mockResolvedValueOnce({ id: 'tpl-global' } as never);
    const result = await repo.findTemplate({ tenantId: 't1', code: 'welcome', channel: 'push' as never, locale: 'en-US' });
    expect(result).toEqual({ id: 'tpl-global' });
    expect(callArg<CallArgRecord>(templateModel.findOne, 1, 0).where).toMatchObject({ tenantId: null, locale: 'en-US' });
  });

  it('findTemplate sin tenantId consulta directamente la global', async () => {
    const { repo, templateModel } = buildRepo();
    (templateModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findTemplate({ tenantId: null, code: 'welcome', channel: 'push' as never });
    // Solo una consulta (la global), sin la del tenant.
    expect(templateModel.findOne).toHaveBeenCalledTimes(1);
    expect(callArg<CallArgRecord>(templateModel.findOne, 0, 0).where.tenantId).toBeNull();
  });

  it('listTemplates arma Op.or tenant/null y aplica filtros + offset', async () => {
    const { repo, templateModel } = buildRepo();
    (templateModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listTemplates('t1', { code: 'welcome', active: true, page: 2, limit: 10 } as never);
    const arg = (templateModel.findAndCountAll as jest.Mock).mock.calls[0][0] as {
      where: Record<string | symbol, unknown>;
      offset: number;
    };
    expect(arg.where[Op.or]).toEqual([{ tenantId: 't1' }, { tenantId: null }]);
    expect(arg.where.code).toBe('welcome');
    expect(arg.where.isActive).toBe(true);
    expect(arg.offset).toBe(10);
  });

  it('createTemplate aplica defaults null en los campos opcionales', async () => {
    const { repo, templateModel } = buildRepo();
    (templateModel.create as jest.Mock).mockResolvedValue({ id: 'tpl1' } as never);
    await repo.createTemplate('t1', {
      code: 'c',
      channel: 'push',
      locale: 'es-BO',
      bodyTemplate: 'b',
      isActive: true,
      version: 1,
    } as never);
    expect((templateModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      titleTemplate: null,
      subjectTemplate: null,
      payloadSchemaJson: null,
      category: null,
      icon: null,
    });
  });

  it('updateTemplate lanza NotFound cuando la plantilla no existe', async () => {
    const { repo, templateModel } = buildRepo();
    (templateModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await expect(repo.updateTemplate('t1', 'x', { code: 'c' } as never)).rejects.toThrow('NOTIFICATION_TEMPLATE_NOT_FOUND');
  });

  it('updateTemplate solo modifica los campos definidos y guarda', async () => {
    const { repo, templateModel } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => ({}));
    const template = { code: 'old', bodyTemplate: 'old', save } as never;
    (templateModel.findOne as jest.Mock).mockResolvedValue(template as never);
    await repo.updateTemplate('t1', 'tpl1', { bodyTemplate: 'new' } as never);
    expect((template as { bodyTemplate: string }).bodyTemplate).toBe('new');
    expect((template as { code: string }).code).toBe('old'); // no tocado
    expect(save).toHaveBeenCalled();
  });

  it('updateTemplate con TODOS los campos definidos los asigna uno a uno', async () => {
    const { repo, templateModel } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => undefined);
    const template = { save } as never;
    (templateModel.findOne as jest.Mock).mockResolvedValue(template as never);

    await repo.updateTemplate('t1', '1', {
      code: 'NEW',
      channel: 'email',
      locale: 'es',
      titleTemplate: 'T',
      subjectTemplate: 'S',
      bodyTemplate: 'B',
      payloadSchema: { a: 1 },
      category: 'system',
      icon: 'bell',
      isActive: false,
      version: 3,
    } as never);

    expect(template).toMatchObject({
      code: 'NEW',
      channel: 'email',
      locale: 'es',
      titleTemplate: 'T',
      subjectTemplate: 'S',
      bodyTemplate: 'B',
      payloadSchemaJson: { a: 1 },
      category: 'system',
      icon: 'bell',
      isActive: false,
      version: 3,
    });
    expect(save).toHaveBeenCalled();
  });

  it('updateTemplate normaliza a null los opcionales enviados como null', async () => {
    const { repo, templateModel } = buildRepo();
    const template = { save: jest.fn(async (..._args: unknown[]) => undefined) } as never;
    (templateModel.findOne as jest.Mock).mockResolvedValue(template as never);

    await repo.updateTemplate('t1', '1', {
      titleTemplate: null,
      subjectTemplate: null,
      payloadSchema: null,
      category: null,
      icon: null,
    } as never);

    expect(template).toMatchObject({ titleTemplate: null, subjectTemplate: null, payloadSchemaJson: null, category: null, icon: null });
  });

  it('listTemplates aplica code/channel/active sobre el OR de tenant propio + global', async () => {
    const { repo, templateModel } = buildRepo();
    (templateModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);

    await repo.listTemplates('t1', { code: 'C', channel: 'email', active: false, page: 2, limit: 10 } as never);

    const args = (templateModel.findAndCountAll as jest.Mock).mock.calls[0][0] as {
      where: Record<string, unknown>;
      offset: number;
      limit: number;
    };
    expect(args.where).toMatchObject({ code: 'C', channel: 'email', isActive: false });
    expect(args).toMatchObject({ offset: 10, limit: 10 });
  });

  it('createTemplate deja en null los opcionales ausentes', async () => {
    const { repo, templateModel } = buildRepo();
    (templateModel.create as jest.Mock).mockResolvedValue({ id: '1' } as never);

    await repo.createTemplate('t1', { code: 'C', channel: 'email', locale: 'es', bodyTemplate: 'B', isActive: true, version: 1 } as never);

    expect((templateModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      titleTemplate: null,
      subjectTemplate: null,
      payloadSchemaJson: null,
      category: null,
      icon: null,
      tenantId: 't1',
    });
  });
});
