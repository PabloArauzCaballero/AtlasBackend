import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { PortalGlossaryService } from '../../../src/modules/internal-portal/application/portal-glossary.service.js';

/**
 * El glosario de negocio: dominios, tablas y campos con sus relaciones.
 *
 * La página, el total, el buscador y los filtros los resuelve PostgreSQL sobre el catálogo entero
 * (antes: 80 dominios, 120 tablas y 240 campos traídos con `LIMIT` fijo y paginados en memoria). Lo
 * que estas pruebas fijan es lo que el servicio hace ALREDEDOR de ese SQL: qué filtros le manda, cómo
 * arma el total, y cómo cruza las relaciones de los términos de la página —sin mayúsculas de por
 * medio y sin duplicar endpoints—. Que el SQL filtre de verdad lo mide la integración contra
 * PostgreSQL (`test/integration/internal-portal/portal-catalog-queries.spec.ts`).
 */
function servicio(query: jest.Mock): PortalGlossaryService {
  return new PortalGlossaryService({ query } as unknown as Sequelize);
}

const TERMINO_DOMINIO = {
  kind: 'domain',
  ref_id: 'credit',
  term_key: 'credit',
  name: 'Crédito',
  definition: 'Todo lo que presta dinero',
  domain: 'credit',
  owner: 'riesgo',
  status: 'ACTIVE',
  updated_at: new Date('2026-09-01T10:00:00Z'),
  data_nature: 'OPERACIONAL',
  schema_name: null,
  table_name: null,
  review_status: null,
  sensitivity_level: null,
};
const TERMINO_TABLA = {
  ...TERMINO_DOMINIO,
  kind: 'table',
  ref_id: '10',
  term_key: 'loans',
  name: 'Préstamos',
  definition: 'Los créditos desembolsados',
  data_nature: null,
  schema_name: 'credit',
  table_name: 'loans',
  review_status: 'APPROVED',
};
const TERMINO_CAMPO = {
  ...TERMINO_DOMINIO,
  kind: 'field',
  ref_id: '100',
  term_key: 'loans.principal_amount',
  name: 'Capital prestado',
  owner: 'data-governance',
  data_nature: null,
  schema_name: 'credit',
  table_name: 'loans',
  sensitivity_level: 'INTERNAL',
};

type Respuestas = {
  page?: unknown[];
  total?: string;
  domainTables?: unknown[];
  fields?: unknown[];
  endpoints?: unknown[];
  fks?: unknown[];
};

/** Responde a cada consulta según la forma del SQL que recibe. */
function doble(respuestas: Respuestas): jest.Mock {
  return jest.fn(async (sql: string) => {
    if (sql.includes('COUNT(*)::text AS total FROM terms')) return [{ total: respuestas.total ?? '3' }] as never;
    if (sql.includes('LIMIT :limit OFFSET :offset') || sql.includes('WHERE kind = :kind AND ref_id = :ref'))
      return (respuestas.page ?? []) as never;
    if (sql.includes('AS module_key')) return (respuestas.domainTables ?? []) as never;
    if (sql.includes('FROM system_data_field_catalog\n WHERE')) return (respuestas.fields ?? []) as never;
    if (sql.includes('FROM system_endpoint_data_entity_impacts i')) return (respuestas.endpoints ?? []) as never;
    if (sql.includes('FROM system_data_relationship_catalog')) return (respuestas.fks ?? []) as never;
    return [] as never;
  }) as unknown as jest.Mock;
}

const replacementsDe = (query: jest.Mock, fragmento: string) =>
  (query.mock.calls.find(([sql]) => String(sql).includes(fragmento))?.[1] as { replacements: Record<string, unknown> }).replacements;

describe('PortalGlossaryService', () => {
  let query: jest.Mock;

  beforeEach(() => {
    query = doble({
      page: [TERMINO_DOMINIO, TERMINO_TABLA, TERMINO_CAMPO],
      domainTables: [{ id: '10', table_name: 'loans', domain_key: 'credit', module_key: 'credit' }],
      fields: [{ data_entity_id: '10', table_name: 'loans', column_name: 'principal_amount', domain_key: 'credit' }],
      endpoints: [{ data_entity_id: '10', method: 'GET', full_path: '/api/v1/loans' }],
    });
  });

  describe('el listado', () => {
    it('manda a SQL el buscador escapado, el dominio, el tipo y la página', async () => {
      await servicio(query).listBusinessTerms({ page: 3, limit: 10, q: 'tasa_50%', domain: 'RIESGO', type: 'table' });

      expect(replacementsDe(query, 'LIMIT :limit OFFSET :offset')).toEqual({
        q: 'tasa_50%',
        like: '%tasa\\_50\\%%',
        domain: 'RIESGO',
        kind: 'table',
        limit: 10,
        offset: 20,
      });
      expect(replacementsDe(query, 'COUNT(*)::text AS total FROM terms')).toMatchObject({ domain: 'RIESGO', kind: 'table' });
    });

    it('un tipo desconocido no filtra: no se inventa un cuarto tipo de término', async () => {
      await servicio(query).listBusinessTerms({ page: 1, limit: 10, type: 'report' });

      expect(replacementsDe(query, 'LIMIT :limit OFFSET :offset')).toMatchObject({ kind: '' });
    });

    it('el total sale del conteo en la base, no del tamaño de la página', async () => {
      query = doble({ page: [TERMINO_CAMPO], total: '1234' });

      const { meta } = await servicio(query).listBusinessTerms({ page: 2, limit: 20 });

      expect(meta).toEqual({ page: 2, limit: 20, total: 1234, totalPages: 62 });
    });

    it('cada término lleva su tipo y su prefijo de identificador', async () => {
      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 20 });

      expect(items.map((item) => [item.termId, item.type])).toEqual([
        ['domain:credit', 'domain'],
        ['table:10', 'table'],
        ['field:100', 'field'],
      ]);
    });

    it('un dominio lleva sus tablas, sus columnas y los endpoints que las tocan', async () => {
      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 20 });

      expect(items[0]).toMatchObject({
        relatedTables: ['loans'],
        relatedColumns: ['loans.principal_amount'],
        relatedEndpoints: ['GET /api/v1/loans'],
      });
    });

    it('el cruce ignora mayúsculas: el dominio `CREDIT` encuentra las tablas de `credit`', async () => {
      query = doble({
        page: [{ ...TERMINO_DOMINIO, ref_id: 'CREDIT', term_key: 'CREDIT' }],
        domainTables: [{ id: '10', table_name: 'loans', domain_key: 'credit', module_key: 'credit' }],
      });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 20 });

      expect(replacementsDe(query, 'AS module_key')).toEqual({ codes: ['credit'] });
      expect(items[0].relatedTables).toEqual(['loans']);
    });

    it('el mismo endpoint declarado dos veces sobre la misma tabla se pinta una sola vez', async () => {
      query = doble({
        page: [TERMINO_TABLA],
        endpoints: [
          { data_entity_id: '10', method: 'GET', full_path: '/api/v1/loans' },
          { data_entity_id: '10', method: 'GET', full_path: '/api/v1/loans' },
        ],
      });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 20 });

      expect(items[0].relatedEndpoints).toEqual(['GET /api/v1/loans']);
    });

    it('una página sólo de campos no pregunta por relaciones: el campo ya sabe de qué tabla es', async () => {
      query = doble({ page: [TERMINO_CAMPO] });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 20 });

      expect(query).toHaveBeenCalledTimes(2);
      expect(items[0]).toMatchObject({ relatedTables: ['loans'], relatedColumns: ['loans.principal_amount'], relatedEndpoints: [] });
    });

    it('sin descripción, dueño ni nombre no salen huecos: cada tipo lleva su valor por defecto', async () => {
      query = doble({ page: [{ ...TERMINO_DOMINIO, name: null, definition: null, owner: null }] });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 20 });

      expect(items[0].name).toBe('credit');
      expect(items[0].definition).toContain('Dominio de negocio');
      expect(items[0].owner).toBe('systems');
    });
  });

  describe('los valores de los filtros', () => {
    it('reparte dominios y tipos con su número de términos, sobre el catálogo entero', async () => {
      query = jest.fn(async () => [
        { facet: 'domain', value: 'CREDIT', total: '40' },
        { facet: 'domain', value: 'platform', total: '7' },
        { facet: 'kind', value: 'field', total: '300' },
      ]) as unknown as jest.Mock;

      const facets = await servicio(query).listBusinessTermFacets();

      expect(facets).toEqual({
        domains: [
          { value: 'CREDIT', total: 40 },
          { value: 'platform', total: 7 },
        ],
        types: [{ value: 'field', total: 300 }],
      });
    });
  });

  describe('la ficha de un término', () => {
    it('se busca por su tipo e identificador en la base, no dentro de una página', async () => {
      query = doble({ page: [TERMINO_TABLA] });

      const ficha = await servicio(query).getBusinessTerm('table:10');

      expect(ficha.termId).toBe('table:10');
      expect(replacementsDe(query, 'WHERE kind = :kind AND ref_id = :ref')).toEqual({ kind: 'table', ref: '10' });
      expect(query.mock.calls.some(([sql]) => String(sql).includes('LIMIT :limit OFFSET :offset'))).toBe(false);
    });

    it('un término que no existe, o de un tipo desconocido, es 404', async () => {
      query = doble({ page: [] });
      await expect(servicio(query).getBusinessTerm('domain:no-existe')).rejects.toBeInstanceOf(NotFoundException);
      await expect(servicio(query).getBusinessTerm('report:1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(servicio(query).getBusinessTerm('sin-prefijo')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('un identificador codificado en la URL se decodifica antes de buscar', async () => {
      query = doble({ page: [TERMINO_DOMINIO] });

      const ficha = await servicio(query).getBusinessTerm(encodeURIComponent('domain:credit'));

      expect(ficha.termId).toBe('domain:credit');
    });

    it('con claves foráneas declaradas, las relaciones son las REALES y llevan sus dos extremos', async () => {
      query = doble({
        page: [TERMINO_TABLA],
        fks: [
          {
            _id: 7,
            source_table: 'loans',
            source_column: 'customer_id',
            target_table: 'customers',
            target_column: '_id',
            relationship_type: 'FOREIGN_KEY',
          },
        ],
      });

      const ficha = await servicio(query).getBusinessTerm('table:10');

      expect(ficha.relations).toEqual([
        expect.objectContaining({
          relationId: 'fk:7',
          relationType: 'FOREIGN_KEY',
          targetId: 'customers',
          sourceTable: 'loans',
          targetColumn: '_id',
        }),
      ]);
    });

    it('sin claves foráneas se declara la relación documental, no una lista vacía', async () => {
      query = doble({ page: [TERMINO_TABLA] });

      const ficha = await servicio(query).getBusinessTerm('table:10');

      expect(ficha.relations).toEqual([expect.objectContaining({ relationType: 'documents', targetType: 'table', targetId: 'loans' })]);
    });

    it('la ficha lleva sinónimos sin huecos y sus restricciones de gobierno', async () => {
      const ficha = await servicio(query).getBusinessTerm('domain:credit');

      expect(ficha.synonyms).toEqual(expect.arrayContaining(['credit', 'Crédito', 'loans']));
      expect(ficha.synonyms.every(Boolean)).toBe(true);
      expect(ficha.restrictions.join(' ')).toContain('PII');
      expect(ficha.audit).toEqual([expect.objectContaining({ auditId: 'audit:domain:credit', actor: 'atlas_backend' })]);
    });
  });
});
