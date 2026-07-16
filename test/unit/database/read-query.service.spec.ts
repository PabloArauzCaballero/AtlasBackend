import { QueryTypes } from 'sequelize';
import { ReadQueryService } from '../../../src/common/database/read-query.service.js';

type QueryCall = { sql: string; options: { type: unknown; replacements: unknown } };

function buildFakeSequelize(rows: unknown[]): {
  calls: QueryCall[];
  instance: { query: (sql: string, options: QueryCall['options']) => Promise<unknown[]> };
} {
  const calls: QueryCall[] = [];
  return {
    calls,
    instance: {
      query: (sql: string, options: QueryCall['options']) => {
        calls.push({ sql, options });
        return Promise.resolve(rows);
      },
    },
  };
}

describe('ReadQueryService', () => {
  it('ejecuta SELECT con QueryTypes.SELECT y pasa los replacements', async () => {
    const fake = buildFakeSequelize([{ id: 1 }]);
    const service = new ReadQueryService(fake.instance as never);

    const rows = await service.select('SELECT * FROM read_api.v_customer_overview_v1 WHERE tenant_id = :t', { t: 1 });

    expect(rows).toEqual([{ id: 1 }]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].options.type).toBe(QueryTypes.SELECT);
    expect(fake.calls[0].options.replacements).toEqual({ t: 1 });
  });

  it('permite CTEs que empiezan con WITH', async () => {
    const fake = buildFakeSequelize([]);
    const service = new ReadQueryService(fake.instance as never);
    await expect(service.select('WITH x AS (SELECT 1) SELECT * FROM x')).resolves.toEqual([]);
  });

  it('rechaza cualquier sentencia que no sea SELECT/WITH', async () => {
    const fake = buildFakeSequelize([]);
    const service = new ReadQueryService(fake.instance as never);

    await expect(service.select('UPDATE customers SET lifecycle_status = :s', { s: 'x' })).rejects.toThrow(
      /solo permite consultas SELECT/i,
    );
    await expect(service.select('DELETE FROM customers')).rejects.toThrow(/solo permite/i);
    await expect(service.select('  insert into customers values (1)')).rejects.toThrow(/solo permite/i);
    expect(fake.calls).toHaveLength(0);
  });

  it('selectOne devuelve la primera fila o null', async () => {
    const withRows = new ReadQueryService(buildFakeSequelize([{ id: 7 }, { id: 8 }]).instance as never);
    expect(await withRows.selectOne('SELECT 1')).toEqual({ id: 7 });

    const empty = new ReadQueryService(buildFakeSequelize([]).instance as never);
    expect(await empty.selectOne('SELECT 1')).toBeNull();
  });
});
