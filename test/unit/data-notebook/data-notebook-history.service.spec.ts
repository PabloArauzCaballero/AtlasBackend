import { describe, expect, it, jest } from '@jest/globals';
import { DataNotebookHistoryService } from '../../../src/modules/data-notebook/data-notebook-history.service.js';

/** El historial propio: el lenguaje se filtra en la consulta, no después de paginar. */
describe('DataNotebookHistoryService · listOwn', () => {
  const montar = () => {
    const findAndCountAll = jest.fn(async (_options: unknown) => ({ rows: [], count: 0 }));
    return { service: new DataNotebookHistoryService({ findAndCountAll } as never), findAndCountAll };
  };
  const usuario = { sub: 'u-1', tenantId: 't-1', role: 'risk_analyst' } as never;

  it('pasa el lenguaje al where para que la página no salga vacía', async () => {
    const { service, findAndCountAll } = montar();

    await service.listOwn(usuario, 20, 0, 'sql');

    expect(findAndCountAll.mock.calls[0][0]).toMatchObject({ where: { actorUserId: 'u-1', language: 'sql' }, limit: 20 });
  });

  it('sin lenguaje no filtra por él (el cuaderno ve todo)', async () => {
    const { service, findAndCountAll } = montar();

    await service.listOwn(usuario, 20);

    expect((findAndCountAll.mock.calls[0][0] as { where: object }).where).not.toHaveProperty('language');
  });
});
