import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { catalogListWhere, latestVersionWithStatus } from '../../../src/modules/catalog-management/catalog-list.query.js';
import { searchGovernancePolicies } from '../../../src/modules/catalog-management/catalog-governance-index.query.js';
import {
  definitionsQuerySchema,
  governancePolicySearchSchema,
  listCatalogsQuerySchema,
} from '../../../src/modules/catalog-management/catalog-list.schemas.js';

describe('Catálogos operativos (P2): filtro en SQL', () => {
  it('q busca «contiene» en código, nombre, dominio y dueño con los comodines escapados', () => {
    const where = catalogListWhere({ q: 'ban_co', status: 'all', active: 'all', page: 1, limit: 20 }) as Record<symbol, unknown[]>;
    expect(where[Op.and]).toEqual([
      {
        [Op.or]: ['catalogCode', 'catalogName', 'domain', 'ownerTeam'].map((field) => ({ [field]: { [Op.iLike]: '%ban\\_co%' } })),
      },
    ]);
  });

  it('el estado se resuelve contra la versión más reciente (mismo orden que la fila) y rechaza valores libres', () => {
    expect(latestVersionWithStatus('draft')).toContain('DISTINCT ON (v.catalog_id)');
    expect(latestVersionWithStatus('draft')).toContain('ORDER BY v.catalog_id, v.valid_from DESC, v._id DESC');
    expect(() => latestVersionWithStatus("x' OR '1'='1")).toThrow();
  });

  it('los esquemas aceptan una letra (antes min(2) respondía 400) y traen página por defecto', () => {
    expect(listCatalogsQuerySchema.parse({ domain: 'b' })).toMatchObject({ domain: 'b', page: 1, limit: 20 });
    expect(definitionsQuerySchema.parse({ domain: 'r', q: 'x' })).toMatchObject({ domain: 'r', q: 'x', page: 1, limit: 20 });
    expect(() => definitionsQuerySchema.parse({ limit: 101 })).toThrow();
  });
});

describe('Políticas de gobierno (L8): lista paginada', () => {
  it('pasa tipo, q escapado y página al SQL y arma summary con el mismo filtro', async () => {
    const calls: Array<{ sql: string; replacements: Record<string, unknown> }> = [];
    const sequelize = {
      query: jest.fn(async (sql: string, options: { replacements: Record<string, unknown> }) => {
        calls.push({ sql, replacements: options.replacements });
        if (sql.includes('GROUP BY e.type'))
          return [
            { type: 'purpose', count: '3', explicit_consent: '2', protected: '0' },
            { type: 'classification', count: '4', explicit_consent: '0', protected: '3' },
            { type: 'sensitive', count: '5', explicit_consent: '0', protected: '0' },
          ];
        return [{ type: 'purpose', raw_id: '12', code: 'MKT', name: 'Marketing', scope: 'consent', is_active: true, attributes: {} }];
      }),
    };
    const query = governancePolicySearchSchema.parse({ q: '10%', type: 'purpose', page: '2', limit: '5' });

    const result = await searchGovernancePolicies(sequelize as never, query);

    expect(calls[0]?.replacements).toMatchObject({ type: 'purpose', like: '%10\\%%', limit: 5, offset: 5 });
    expect(calls[1]?.replacements).toMatchObject({ type: 'purpose', like: '%10\\%%' });
    expect(result.items[0]).toMatchObject({ policyId: 'purpose:12', type: 'purpose', code: 'MKT' });
    expect(result.meta).toEqual({ page: 2, limit: 5, total: 12, totalPages: 3 });
    expect(result.summary).toEqual({
      total: 12,
      byType: { purpose: 3, classification: 4, sensitive: 5 },
      sensitiveFields: 5,
      explicitConsent: 2,
      protectedClasses: 3,
    });
  });

  it('rechaza un tipo que no existe', () => {
    expect(() => governancePolicySearchSchema.parse({ type: 'provider' })).toThrow();
  });
});
