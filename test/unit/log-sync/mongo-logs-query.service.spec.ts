import { describe, expect, it, jest } from '@jest/globals';
import { MongoLogsQueryService } from '../../../src/modules/log-sync/mongo-logs-query.service.js';
import { escapeRegex } from '../../../src/common/utils/strings/regex.util.js';

/**
 * `MongoLogsQueryService.listLogs` arma el filtro de Mongo (tratando la búsqueda como texto plano
 * para evitar ReDoS), pagina y mapea. Se espía `getCollection` (que abre un MongoClient real) para
 * inyectar una colección falsa y ejercitar esa lógica sin una base Mongo viva.
 */
describe('MongoLogsQueryService', () => {
  function build(items: unknown[] = [], total = 0) {
    const chain: Record<string, jest.Mock> = {
      sort: jest.fn(() => chain),
      skip: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      toArray: jest.fn(async () => items),
    };
    const collection = { find: jest.fn(() => chain), countDocuments: jest.fn(async () => total) };
    const service = new MongoLogsQueryService();
    jest.spyOn(service as unknown as { getCollection: () => Promise<unknown> }, 'getCollection').mockResolvedValue(collection as never);
    return { service, collection, chain };
  }

  it('arma los filtros (type/service/q escapado/rango) y pagina con skip/limit correctos', async () => {
    const { service, collection, chain } = build([], 0);
    await service.listLogs({ type: 'error', service: 'atlas', q: 'a.b*c', from: '2026-01-01', to: '2026-02-01', page: 2, limit: 10 } as never);
    const filter = (collection.find.mock.calls[0] as [Record<string, { $gte?: Date; $lte?: Date }>])[0];
    expect(filter).toMatchObject({ type: 'error', service: 'atlas', content: { $regex: escapeRegex('a.b*c'), $options: 'i' } });
    expect(filter.capturedAt.$gte).toBeInstanceOf(Date);
    expect(filter.capturedAt.$lte).toBeInstanceOf(Date);
    expect(chain.skip).toHaveBeenCalledWith(10); // (2-1)*10
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it('mapea los items y arma el meta con totalPages >= 1', async () => {
    const { service } = build([{ _id: 'oid1', type: 'error', service: 'atlas', capturedAt: 'x', content: 'log', lineCount: 3 }], 0);
    const res = await service.listLogs({ page: 1, limit: 20 } as never);
    expect(res.items[0]).toMatchObject({ id: 'oid1', type: 'error', content: 'log', lineCount: 3 });
    expect(res.meta).toMatchObject({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  it('sin filtros opcionales manda un filtro vacío', async () => {
    const { service, collection } = build([], 5);
    await service.listLogs({ page: 1, limit: 20 } as never);
    expect((collection.find.mock.calls[0] as [Record<string, unknown>])[0]).toEqual({});
  });
});
