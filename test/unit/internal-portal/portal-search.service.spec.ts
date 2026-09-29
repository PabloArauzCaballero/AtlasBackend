import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { PortalSearchService } from '../../../src/modules/internal-portal/application/portal-search.service.js';

/**
 * Búsqueda global del portal. Antes cada tipo traía `LIMIT 15`, ignoraba el `limit` pedido y
 * `totals` contaba las filas DEVUELTAS: nunca pasaba de 15 aunque hubiera 200 endpoints que casaran,
 * y el resto era inalcanzable. Se fija aquí que `totals` sale de un COUNT, que cada tipo se pagina con
 * `page`/`limit` y que lo escrito se busca literal (`_` y `%` escapados).
 */
describe('PortalSearchService', () => {
  let query: jest.Mock;
  let service: PortalSearchService;
  const cuentas: Record<string, number> = { system_endpoint_catalog: 42, system_data_entity_catalog: 3, data_quality_rules: 0 };

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      const tabla = Object.keys(cuentas).find((nombre) => sql.includes(nombre)) ?? '';
      if (sql.includes('COUNT(*)')) return [{ count: String(cuentas[tabla]) }];
      if (tabla === 'system_endpoint_catalog') return [{ _id: 1, method: 'GET', full_path: '/api/v1/loans', route_name: 'listLoans' }];
      if (tabla === 'system_data_entity_catalog') return [{ _id: 2, table_name: 'loans', entity_name: 'Loan' }];
      return [];
    }) as unknown as jest.Mock;
    service = new PortalSearchService({ query } as unknown as Sequelize);
  });

  const llamadas = () =>
    query.mock.calls.map((llamada) => ({ sql: llamada[0] as string, opts: llamada[1] as { replacements: Record<string, unknown> } }));

  it('sin texto no consulta la base', async () => {
    const resultado = await service.search({ q: '  ' });
    expect(resultado.items).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('totals es el COUNT real de cada tipo, no las filas devueltas', async () => {
    const resultado = await service.search({ q: 'loan', kind: 'endpoint', page: 1, limit: 20 });
    expect(resultado.totals).toMatchObject({ endpoints: 42, tables: 3, qualityRules: 0 });
    expect(resultado.items).toHaveLength(1);
    expect(resultado.meta).toEqual({ page: 1, limit: 20, total: 42, totalPages: 3 });
  });

  it('con `kind` sólo pagina ese tipo y respeta page/limit (sin LIMIT 15 fijo)', async () => {
    await service.search({ q: 'loan', kind: 'endpoint', page: 3, limit: 20 });
    const pagina = llamadas().filter((llamada) => llamada.sql.includes('LIMIT :limit'));
    expect(pagina).toHaveLength(1);
    expect(pagina[0].sql).toContain('system_endpoint_catalog');
    expect(pagina[0].opts.replacements).toMatchObject({ limit: 20, offset: 40 });
    expect(llamadas().some((llamada) => llamada.sql.includes('LIMIT 15'))).toBe(false);
  });

  it('sin `kind` trae una página de cada tipo y meta.totalPages es la del tipo con más páginas', async () => {
    const resultado = await service.search({ q: 'loan', page: 1, limit: 10 });
    expect(new Set(resultado.items.map((item) => item.kind))).toEqual(new Set(['endpoint', 'table']));
    expect(resultado.meta.totalPages).toBe(5);
  });

  it('escapa los comodines: buscar `user_id` no casa con `userXid`', async () => {
    await service.search({ q: 'user_id', kind: 'table' });
    expect(llamadas()[0].opts.replacements.like).toBe('%user\\_id%');
  });

  it('los reportes (catálogo del código) se cuentan y paginan completos en memoria', async () => {
    const todos = await service.search({ q: 'a', kind: 'report', page: 1, limit: 1 });
    const total = (todos.totals as Record<string, number>).reports;
    expect(total).toBeGreaterThan(0);
    expect(todos.items.length).toBeLessThanOrEqual(1);
    expect(todos.meta.total).toBe(total);
  });
});
