import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { InternalPortalService } from '../../../src/modules/internal-portal/internal-portal.service.js';

/**
 * `getBusinessTerm('field:X')` solía llamar `listBusinessTerms({page:1, limit:500})` (4 queries
 * — domains LIMIT 80, tables LIMIT 120, fields LIMIT 240, más impacts) solo para hacer `.find()`
 * sobre UNA fila. Un término de campo no necesita cruzar contra el resto del catálogo (a
 * diferencia de domain:/table:), así que ahora resuelve con una sola query dirigida por id. Estos
 * tests fijan que (a) el fast path realmente evita las queries de listBusinessTerms y (b) el
 * resultado es idéntico al que producía el camino viejo.
 */
function buildService(queryImpl: (sql: string, options: { replacements?: Record<string, unknown> }) => Promise<unknown[]>) {
  const sequelize = { query: jest.fn(queryImpl) };
  return { service: new InternalPortalService(sequelize as never), sequelize };
}

const fieldRow = {
  _id: '42',
  data_entity_id: '7',
  schema_name: 'public',
  table_name: 'customers',
  column_name: 'primary_phone_hash',
  business_name: 'Hash de teléfono principal',
  business_meaning: 'Identificador estable de contacto para deduplicación.',
  domain_code: 'IDENTIDAD_KYC',
  sensitivity_level: 'CONFIDENTIAL',
  referenced_table: null,
  referenced_column: null,
  _updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('InternalPortalService.getBusinessTerm — field: fast path', () => {
  it('resolves a field: termId with a single direct query (plus the unrelated FK-relations lookup), without touching listBusinessTerms', async () => {
    const { service, sequelize } = buildService(async (sql) => {
      if (sql.includes('FROM system_data_field_catalog')) {
        expect(sql).toContain('WHERE _id = :fieldId');
        return [fieldRow];
      }
      if (sql.includes('FROM system_data_relationship_catalog')) return [];
      throw new Error(`unexpected query in test: ${sql}`);
    });

    const result = await service.getBusinessTerm('field:42');

    // 2 queries: la del fast path (field por id) + la de FK relations que getBusinessTerm ya
    // hacía siempre que el término trae relatedTables — nunca las 4 de listBusinessTerms.
    expect(sequelize.query).toHaveBeenCalledTimes(2);
    expect(result.termId).toBe('field:42');
    expect(result.key).toBe('customers.primary_phone_hash');
    expect(result.relatedTables).toEqual(['customers']);
  });

  it('throws NotFoundException when the field id does not exist, without falling back to listBusinessTerms', async () => {
    const { service, sequelize } = buildService(async () => []);

    await expect(service.getBusinessTerm('field:999')).rejects.toThrow(NotFoundException);
    expect(sequelize.query).toHaveBeenCalledTimes(1);
  });

  it('excludes a DEPRECATED field, matching the old list-based behavior (same WHERE filter as listBusinessTerms)', async () => {
    const { service } = buildService(async (sql, options) => {
      // El fast path debe filtrar deprecated en SQL, igual que el query de listBusinessTerms.
      expect(sql).toContain("COALESCE(status, 'ACTIVE') <> 'DEPRECATED'");
      expect(options.replacements).toEqual({ fieldId: '999' });
      return [];
    });

    await expect(service.getBusinessTerm('field:999')).rejects.toThrow(NotFoundException);
  });

  it('still uses the full listBusinessTerms path for domain: and table: termIds (needs cross-catalog relations)', async () => {
    const { service, sequelize } = buildService(async (sql) => {
      if (sql.includes('FROM system_domain_catalog')) return [{ _id: '1', domain_code: 'RIESGO_CREDITO', domain_name: 'Riesgo' }];
      if (sql.includes('FROM system_data_entity_catalog')) return [];
      if (sql.includes('FROM system_data_field_catalog')) return [];
      if (sql.includes('FROM system_endpoint_data_entity_impacts')) return [];
      return [];
    });

    const result = await service.getBusinessTerm('domain:RIESGO_CREDITO');

    expect(result.termId).toBe('domain:RIESGO_CREDITO');
    // 3 queries paralelas de listBusinessTerms (domains/tables/fields); sin entityIds no hay
    // query de impacts, y sin relatedTables tampoco hay query de FK relations.
    expect(sequelize.query).toHaveBeenCalledTimes(3);
  });
});
