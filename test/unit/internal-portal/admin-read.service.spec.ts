import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { ReadQueryService } from '../../../src/common/database/read-query.service.js';
import { AdminReadService } from '../../../src/modules/internal-portal/application/admin-read.service.js';
import { customerViewQuerySchema } from '../../../src/modules/internal-portal/admin-read.schemas.js';

function buildService() {
  const select = jest.fn<ReadQueryService['select']>(async (sql: string) => {
    if (sql.includes('COUNT(')) return [{ count: '1' }] as never;
    return [{ customerId: '7', displayName: 'Ada' }] as never;
  });
  return { service: new AdminReadService({ select } as unknown as ReadQueryService), select };
}

describe('AdminReadService', () => {
  it('proyecta únicamente los campos solicitados y fuerza aislamiento por tenant', async () => {
    const { service, select } = buildService();

    const result = await service.listCustomers('9', {
      page: 1,
      limit: 20,
      fields: ['customerId', 'displayName'],
    });

    const rowSql = String(select.mock.calls.find(([sql]) => !String(sql).includes('COUNT('))?.[0]);
    expect(rowSql).toContain('SELECT customer_id AS "customerId", display_name AS "displayName"');
    expect(rowSql).toContain('FROM read_api.v_customer_overview_v1 WHERE tenant_id = :tenantId');
    expect(rowSql).not.toContain('SELECT *');
    expect(select.mock.calls[0]?.[1]).toMatchObject({ tenantId: '9', limit: 20, offset: 0 });
    expect(result.meta.selectedFields).toEqual(['customerId', 'displayName']);
  });

  it('rechaza campos fuera del allowlist antes de construir SQL', async () => {
    const { service, select } = buildService();

    await expect(service.listCustomers('9', { page: 1, limit: 20, fields: ['customerId', 'passwordHash'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(select).not.toHaveBeenCalled();
  });

  it('no aplica tenant a vistas globales de salud de proveedores', async () => {
    const { service, select } = buildService();

    await service.listProviderHealth({ page: 2, limit: 10 });

    const rowSql = String(select.mock.calls.find(([sql]) => !String(sql).includes('COUNT('))?.[0]);
    expect(rowSql).toContain('FROM read_api.v_provider_health_latest_v1');
    expect(rowSql).not.toContain('tenant_id');
    expect(select.mock.calls[0]?.[1]).toMatchObject({ limit: 10, offset: 10 });
  });
});

describe('AdminReadService: buscador y valores de filtro', () => {
  it('todas las vistas buscan con `q` en sus columnas declaradas, con el patrón escapado', async () => {
    const { service, select } = buildService();

    await service.listRiskAssessments('9', { page: 1, limit: 20, q: 'v2_%' });

    const [rowSql, replacements] = select.mock.calls.find(([sql]) => !String(sql).includes('COUNT(')) ?? [];
    expect(String(rowSql)).toContain("COALESCE(model_version_code::text, '') ILIKE :search");
    expect(replacements).toMatchObject({ search: '%v2\\_\\%%', tenantId: '9' });
  });

  it('los filtros declarados se comparan sin distinguir mayúsculas y los exactos tal cual', async () => {
    const { service, select } = buildService();

    await service.listWorkQueue('9', { page: 1, limit: 20, status: 'OPEN', assignedTo: 5 });

    const rowSql = String(select.mock.calls.find(([sql]) => !String(sql).includes('COUNT('))?.[0]);
    expect(rowSql).toContain('lower(status::text) = lower(:filter_status)');
    expect(rowSql).toContain('assigned_to = :filter_assignedTo');
  });

  it('los valores de cada filtro salen de la vista entera, acotada al tenant', async () => {
    const select = jest.fn<ReadQueryService['select']>(
      async (sql: string) => (sql.includes('lifecycle_status') ? [{ value: 'ACTIVE' }, { value: 'BLOCKED' }] : [{ value: 'LOW' }]) as never,
    );
    const service = new AdminReadService({ select } as unknown as ReadQueryService);

    const result = await service.listFacets('customers', '9');

    expect(result).toEqual({ view: 'customers', facets: { status: ['ACTIVE', 'BLOCKED'], riskBand: ['LOW'] } });
    for (const [sql, replacements] of select.mock.calls) {
      expect(String(sql)).toContain('tenant_id = :tenantId');
      expect(replacements).toMatchObject({ tenantId: '9', limit: 200 });
    }
  });

  it('una vista por tenant sin tenant falla antes de consultar; una global no lo necesita', async () => {
    const { service, select } = buildService();

    await expect(service.listFacets('work-queue')).rejects.toBeInstanceOf(BadRequestException);
    expect(select).not.toHaveBeenCalled();
    await service.listFacets('provider-health');
    expect(String(select.mock.calls[0]?.[0])).not.toContain('tenant_id');
  });
});

describe('customerViewQuerySchema', () => {
  it('normaliza fields, límites y rechaza parámetros no soportados', () => {
    expect(customerViewQuerySchema.parse({ fields: 'customerId,displayName,customerId', limit: '25' })).toMatchObject({
      page: 1,
      limit: 25,
      fields: ['customerId', 'displayName'],
    });
    expect(() => customerViewQuerySchema.parse({ include: 'everything' })).toThrow();
  });
});
