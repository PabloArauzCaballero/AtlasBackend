import { describe, expect, it, jest } from '@jest/globals';
import { ProcessCatalogRepository } from '../../../src/modules/workflow-catalog/process-catalog.repository.js';
import type { ProcessInstanceEntity } from '../../../src/modules/workflow-catalog/definitions/workflow-definition.types.js';

const CUSTOMERS: ProcessInstanceEntity = {
  system: 'ATLAS_BACKEND',
  schema: 'customer',
  table: 'customers',
  idColumn: '_id',
  statusColumn: 'lifecycle_status',
  labelColumn: 'customer_code',
};

function build(hasTenant = true) {
  const query = jest.fn(async (sql: string, _options?: unknown) => {
    if (/information_schema/.test(sql)) return [{ n: hasTenant ? 1 : 0 }];
    if (/count\(\*\)::int AS n/.test(sql)) return [{ n: 1 }];
    return [{ id: '1', label: 'CUS-1', status: 'registered' }];
  });
  return { repository: new ProcessCatalogRepository({ query } as never), query };
}

describe('ProcessCatalogRepository', () => {
  it('filtra por tenant cuando la tabla lo tiene, y el tenant va como parámetro', async () => {
    const { repository, query } = build(true);
    await repository.countByStatus(CUSTOMERS, '42');
    const [sql, options] = query.mock.calls.at(-1)!;
    expect(sql).toContain('_tenant_id = :tenantId');
    expect((options as { replacements: Record<string, unknown> }).replacements.tenantId).toBe('42');
  });

  it('usa el esquema real de la tabla aunque la fixture diga otro', async () => {
    const { repository, query } = build(true);
    await repository.countByStatus({ ...CUSTOMERS, schema: 'otro' }, '1');
    expect(query.mock.calls.at(-1)![0]).toContain('customer.customers');
  });

  it('rechaza una tabla que no es del dominio o una columna con forma rara', async () => {
    const { repository } = build();
    await expect(repository.countByStatus({ ...CUSTOMERS, table: 'pg_shadow' }, '1')).rejects.toThrow('PROCESS_INSTANCE_ENTITY_INVALID');
    await expect(repository.countByStatus({ ...CUSTOMERS, statusColumn: 'status; drop table x' }, '1')).rejects.toThrow(
      'PROCESS_INSTANCE_ENTITY_INVALID',
    );
  });

  it('pagina con límite y desplazamiento parametrizados y devuelve el total', async () => {
    const { repository, query } = build(false);
    const page = await repository.listInstances(CUSTOMERS, '1', { status: 'registered', search: 'CUS', limit: 10, offset: 20 });
    expect(page.total).toBe(1);
    const [sql, options] = query.mock.calls.find(([s]) => /LIMIT :limit/.test(s))!;
    expect(sql).not.toContain('_tenant_id');
    expect((options as { replacements: Record<string, unknown> }).replacements).toMatchObject({
      limit: 10,
      offset: 20,
      status: 'registered',
      like: '%CUS%',
    });
  });

  it('no consulta Flujos si no hay rutas que buscar', async () => {
    const { repository, query } = build();
    expect(await repository.flowsFor([])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('devuelve null si la instancia no existe', async () => {
    const query = jest.fn(async (sql: string) => (/information_schema/.test(sql) ? [{ n: 0 }] : []));
    const repository = new ProcessCatalogRepository({ query } as never);
    expect(await repository.findInstance(CUSTOMERS, '1', '9')).toBeNull();
  });
});
