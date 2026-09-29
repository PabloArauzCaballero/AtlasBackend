import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { ConsentDocumentAdminService } from '../../../src/modules/consents/consent-document-admin.service.js';

/**
 * El listado del portal de documentos de consentimiento: busca, filtra y pagina en el servidor.
 * El total es el del FILTRO y el resumen es el del catálogo entero, para que las cifras no bailen
 * al buscar.
 */
function build(counts: number[] = [0, 0, 0]) {
  const documents = {
    findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })),
    count: jest.fn(async () => 0),
  };
  counts.forEach((valor) => documents.count.mockResolvedValueOnce(valor as never));
  return { documents, service: new ConsentDocumentAdminService(documents as never) };
}

describe('ConsentDocumentAdminService.list', () => {
  it('pide sólo la página y busca por partes en código, título y resumen con los comodines escapados', async () => {
    const { documents, service } = build();

    await service.list('t1', { q: '100%', status: 'retired', page: 2, limit: 5 });

    const options = (documents.findAndCountAll.mock.calls as unknown[][])[0]?.[0] as {
      where: Record<string | symbol, unknown>;
      limit: number;
      offset: number;
    };
    expect(options).toMatchObject({ limit: 5, offset: 5 });
    expect(options.where).toMatchObject({ tenantId: 't1', status: 'retired' });
    expect(options.where[Op.and]).toEqual([
      { [Op.or]: ['documentCode', 'title', 'summary'].map((columna) => ({ [columna]: { [Op.iLike]: '%100\\%%' } })) },
    ]);
  });

  it('sin texto ni estado no filtra y el meta usa el total del filtro', async () => {
    const { documents, service } = build();
    documents.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 12 } as never);

    const page = await service.list('t1', { page: 1, limit: 5 });

    expect(((documents.findAndCountAll.mock.calls as unknown[][])[0]?.[0] as { where: unknown }).where).toEqual({ tenantId: 't1' });
    expect(page.meta).toEqual({ page: 1, limit: 5, total: 12, totalPages: 3 });
  });

  it('el resumen cuenta vigentes, borradores y retirados del catálogo entero', async () => {
    const { documents, service } = build([4, 1, 6]);

    const { summary } = await service.list('t1', { q: 'zzz', page: 1, limit: 20 });

    expect(summary).toEqual({ total: 11, published: 4, draft: 1, retired: 6 });
    expect((documents.count.mock.calls as unknown[][]).map((call) => (call[0] as { where: unknown }).where)).toEqual([
      { tenantId: 't1', status: 'published' },
      { tenantId: 't1', status: 'draft' },
      { tenantId: 't1', status: 'retired' },
    ]);
  });
});
