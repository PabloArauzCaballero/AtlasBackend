import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { InternalPortalService } from '../../../src/modules/internal-portal/internal-portal.service.js';

/**
 * La ficha de un término desde la fachada.
 *
 * Antes `getBusinessTerm('domain:…'|'table:…')` llamaba a `listBusinessTerms({ limit: 500 })` —que
 * a su vez leía 80 dominios, 120 tablas y 240 campos— y buscaba el término con `.find()`: una tabla
 * más allá de la 120 respondía 404 aunque existiera. Ahora los tres tipos se resuelven con UNA
 * consulta dirigida por (tipo, id); las relaciones se cruzan después sólo para ese término.
 */
function buildService(queryImpl: (sql: string, options: { replacements?: Record<string, unknown> }) => Promise<unknown[]>) {
  const sequelize = { query: jest.fn(queryImpl) };
  return { service: new InternalPortalService(sequelize as never), sequelize };
}

const campo = {
  kind: 'field',
  ref_id: '42',
  term_key: 'customers.primary_phone_hash',
  name: 'Hash de teléfono principal',
  definition: 'Identificador estable de contacto para deduplicación.',
  domain: 'IDENTIDAD_KYC',
  owner: 'data-governance',
  status: 'ACTIVE',
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  data_nature: null,
  schema_name: 'public',
  table_name: 'customers',
  review_status: null,
  sensitivity_level: 'CONFIDENTIAL',
};

describe('InternalPortalService.getBusinessTerm', () => {
  it('un campo se resuelve con su consulta dirigida y la de claves foráneas, nada más', async () => {
    const { service, sequelize } = buildService(async (sql, options) => {
      if (sql.includes('WHERE kind = :kind AND ref_id = :ref')) {
        expect(options.replacements).toEqual({ kind: 'field', ref: '42' });
        return [campo];
      }
      if (sql.includes('FROM system_data_relationship_catalog')) return [];
      throw new Error(`consulta inesperada: ${sql}`);
    });

    const result = await service.getBusinessTerm('field:42');

    expect(sequelize.query).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ termId: 'field:42', key: 'customers.primary_phone_hash', relatedTables: ['customers'] });
  });

  it('una tabla cualquiera —también la 500— se encuentra por su id, sin leer ninguna página', async () => {
    const tabla = { ...campo, kind: 'table', ref_id: '500', term_key: 'late_table', table_name: 'late_table', sensitivity_level: null };
    const { service, sequelize } = buildService(async (sql) => {
      if (sql.includes('WHERE kind = :kind AND ref_id = :ref')) return [tabla];
      return [];
    });

    const result = await service.getBusinessTerm('table:500');

    expect(result.termId).toBe('table:500');
    const sqls = sequelize.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => sql.includes('LIMIT :limit OFFSET :offset'))).toBe(false);
  });

  it('los campos DEPRECADOS quedan fuera: el catálogo de términos los excluye en SQL', async () => {
    const { service } = buildService(async (sql) => {
      expect(sql).toContain("COALESCE(f.status, 'ACTIVE') <> 'DEPRECATED'");
      return [];
    });

    await expect(service.getBusinessTerm('field:999')).rejects.toThrow(NotFoundException);
  });
});
