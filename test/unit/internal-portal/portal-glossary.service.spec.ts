import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { PortalGlossaryService } from '../../../src/modules/internal-portal/application/portal-glossary.service.js';

/**
 * El glosario de negocio: dominios, tablas y campos con sus relaciones.
 *
 * Es un catálogo COMPUESTO —tres consultas que se cruzan en memoria— y ahí está lo que se prueba:
 * el cruce, no el SQL.
 *
 * Las relaciones se arman con lo ya cargado y no con una consulta por término. Con 80 dominios, 120
 * tablas y 240 campos, resolver «qué tablas tiene este dominio» preguntando a la base por cada uno
 * serían cientos de idas para ordenar algo que ya está en la mano.
 *
 * El cruce es INSENSIBLE a mayúsculas por los dos lados, porque `domain_code`, `module` y
 * `table_name` los escriben personas distintas en momentos distintos: una tabla catalogada como
 * `Credit` y un dominio `credit` son el mismo dominio, y tratarlos como distintos deja la ficha del
 * dominio vacía sin que nada falle.
 *
 * Un campo cuyo dominio no está declarado se cuelga del dominio de SU TABLA. Si no, el campo
 * desaparece del glosario: existe en la base, está catalogado, y no aparece en ninguna ficha.
 *
 * Y los endpoints que tocan una tabla se deduplican: el mismo `GET /x` declarado dos veces sobre la
 * misma entidad se pintaría dos veces en la ficha.
 */
function servicio(query: jest.Mock): PortalGlossaryService {
  return new PortalGlossaryService({ query } as unknown as Sequelize);
}

/** Responde a cada consulta según la tabla que menciona. */
function porTabla(filas: Record<string, unknown[]>): jest.Mock {
  return jest.fn(async (sql: string) => {
    const tabla = Object.keys(filas).find((nombre) => (sql as string).includes(nombre));
    return (filas[tabla ?? ''] ?? []) as never;
  }) as unknown as jest.Mock;
}

const DOMINIO = {
  _id: 1,
  domain_code: 'credit',
  domain_name: 'Crédito',
  description: 'Todo lo que presta dinero',
  owner_team: 'riesgo',
  data_nature: 'OPERACIONAL',
  _updated_at: new Date('2026-09-01T10:00:00Z'),
};

const TABLA = {
  _id: 10,
  schema_name: 'credit',
  table_name: 'loans',
  entity_name: 'Préstamos',
  module: 'credit',
  domain_code: 'credit',
  business_purpose: 'Los créditos desembolsados',
  data_owner: 'riesgo',
  status: 'ACTIVE',
  review_status: 'REVIEWED',
  _updated_at: new Date('2026-09-01T10:00:00Z'),
};

const CAMPO = {
  _id: 100,
  data_entity_id: 10,
  schema_name: 'credit',
  table_name: 'loans',
  column_name: 'principal_amount',
  business_name: 'Capital prestado',
  business_meaning: 'Lo que se entregó al cliente',
  domain_code: 'credit',
  sensitivity_level: 'INTERNAL',
  referenced_table: null,
  referenced_column: null,
  _updated_at: new Date('2026-09-01T10:00:00Z'),
};

describe('PortalGlossaryService', () => {
  let query: jest.Mock;

  beforeEach(() => {
    query = porTabla({
      system_domain_catalog: [DOMINIO],
      system_data_entity_catalog: [TABLA],
      system_data_field_catalog: [CAMPO],
      system_endpoint_data_entity_impacts: [{ data_entity_id: 10, method: 'GET', full_path: '/api/v1/loans' }],
      system_data_relationship_catalog: [],
    });
  });

  describe('el catálogo compuesto', () => {
    it('mezcla dominios, tablas y campos, cada uno con su prefijo de identificador', async () => {
      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      expect(items.map((item) => item.termId)).toEqual(['domain:credit', 'table:10', 'field:100']);
    });

    it('las relaciones se arman con lo ya cargado: cuatro consultas, no una por término', async () => {
      await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      expect(query).toHaveBeenCalledTimes(4);
    });

    it('un dominio lleva sus tablas, sus columnas y los endpoints que las tocan', async () => {
      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 50 });
      const dominio = items[0] as { relatedTables: string[]; relatedColumns: string[]; relatedEndpoints: string[] };

      expect(dominio.relatedTables).toEqual(['loans']);
      expect(dominio.relatedColumns).toEqual(['loans.principal_amount']);
      expect(dominio.relatedEndpoints).toEqual(['GET /api/v1/loans']);
    });

    it('el cruce ignora mayúsculas: `Credit` y `credit` son el mismo dominio', async () => {
      query = porTabla({
        system_domain_catalog: [{ ...DOMINIO, domain_code: 'CREDIT' }],
        system_data_entity_catalog: [{ ...TABLA, domain_code: 'Credit', module: 'Credit' }],
        system_data_field_catalog: [{ ...CAMPO, domain_code: 'credit' }],
        system_endpoint_data_entity_impacts: [],
        system_data_relationship_catalog: [],
      });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      expect(items[0].relatedTables).toEqual(['loans']);
    });

    it('una tabla sin `domain_code` se cuelga de su MÓDULO: si no, el dominio saldría vacío', async () => {
      query = porTabla({
        system_domain_catalog: [DOMINIO],
        system_data_entity_catalog: [{ ...TABLA, domain_code: null, module: 'credit' }],
        system_data_field_catalog: [],
        system_endpoint_data_entity_impacts: [],
        system_data_relationship_catalog: [],
      });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      expect(items[0].relatedTables).toEqual(['loans']);
    });

    it('un campo sin dominio declarado se cuelga del dominio de SU TABLA, no desaparece', async () => {
      query = porTabla({
        system_domain_catalog: [DOMINIO],
        system_data_entity_catalog: [TABLA],
        system_data_field_catalog: [{ ...CAMPO, domain_code: null }],
        system_endpoint_data_entity_impacts: [],
        system_data_relationship_catalog: [],
      });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      expect(items[0].relatedColumns).toEqual(['loans.principal_amount']);
    });

    it('el mismo endpoint declarado dos veces sobre la misma tabla se pinta una sola vez', async () => {
      query = porTabla({
        system_domain_catalog: [DOMINIO],
        system_data_entity_catalog: [TABLA],
        system_data_field_catalog: [],
        system_endpoint_data_entity_impacts: [
          { data_entity_id: 10, method: 'GET', full_path: '/api/v1/loans' },
          { data_entity_id: 10, method: 'GET', full_path: '/api/v1/loans' },
        ],
        system_data_relationship_catalog: [],
      });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      const conEndpoints = items as Array<{ relatedEndpoints: string[] }>;
      expect(conEndpoints[0].relatedEndpoints).toEqual(['GET /api/v1/loans']);
      expect(conEndpoints[1].relatedEndpoints).toEqual(['GET /api/v1/loans']);
    });

    it('sin tablas catalogadas no se pregunta por los endpoints: un `IN ()` vacío no aporta nada', async () => {
      query = porTabla({
        system_domain_catalog: [DOMINIO],
        system_data_entity_catalog: [],
        system_data_field_catalog: [],
        system_data_relationship_catalog: [],
      });

      await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      expect(query.mock.calls.some((llamada) => String(llamada[0]).includes('system_endpoint_data_entity_impacts'))).toBe(false);
    });

    it('un dominio sin descripción, dueño ni nombre no sale con huecos: lleva su valor por defecto', async () => {
      query = porTabla({
        system_domain_catalog: [{ ...DOMINIO, domain_name: null, description: null, owner_team: null }],
        system_data_entity_catalog: [],
        system_data_field_catalog: [],
        system_data_relationship_catalog: [],
      });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      expect(items[0].name).toBe('credit');
      expect(items[0].definition).toContain('Dominio de negocio');
      expect(items[0].owner).toBe('systems');
    });

    it('un campo sin nombre de negocio cae a su nombre de columna', async () => {
      query = porTabla({
        system_domain_catalog: [],
        system_data_entity_catalog: [],
        system_data_field_catalog: [{ ...CAMPO, business_name: null, business_meaning: null, domain_code: null }],
        system_data_relationship_catalog: [],
      });

      const { items } = await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      expect(items[0].name).toBe('principal_amount');
      expect(items[0].domain).toBe('PLATAFORMA');
      expect((items[0].metadata as { sensitivityLevel: string }).sensitivityLevel).toBe('INTERNAL');
    });

    it('el buscador filtra el catálogo ya compuesto, y mira TODO el término y no sólo su nombre', async () => {
      const soloElCampo = await servicio(query).listBusinessTerms({ page: 1, limit: 50, q: 'Capital prestado' });
      expect(soloElCampo.items.map((item) => item.termId)).toEqual(['field:100']);

      /*
       * `principal_amount` aparece también en `relatedColumns` del dominio y de la tabla, así que
       * los tres son coincidencias legítimas: quien busca el nombre de una columna quiere saber
       * dónde vive, no sólo su ficha. Se fija aquí porque la lectura contraria —«el buscador está
       * roto, devuelve de más»— llevaría a estrecharlo al nombre y a perder justo eso.
       */
      const dondeVive = await servicio(query).listBusinessTerms({ page: 1, limit: 50, q: 'principal_amount' });
      expect(dondeVive.items.map((item) => item.termId)).toEqual(['domain:credit', 'table:10', 'field:100']);
    });

    it('los campos DEPRECADOS no entran en el catálogo', async () => {
      await servicio(query).listBusinessTerms({ page: 1, limit: 50 });

      const sql = query.mock.calls.map((llamada) => String(llamada[0])).find((texto) => texto.includes('system_data_field_catalog'));
      expect(sql).toContain("<> 'DEPRECATED'");
    });
  });

  describe('la ficha de un término', () => {
    it('un término que no existe es 404', async () => {
      await expect(servicio(query).getBusinessTerm('domain:no-existe')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('los sinónimos salen de la clave, el nombre y sus relaciones, sin huecos', async () => {
      const ficha = await servicio(query).getBusinessTerm('domain:credit');

      expect(ficha.synonyms).toContain('credit');
      expect(ficha.synonyms).toContain('Crédito');
      expect(ficha.synonyms).toContain('loans');
      expect(ficha.synonyms.every(Boolean)).toBe(true);
    });

    it('con claves foráneas declaradas, las relaciones son las REALES y llevan sus dos extremos', async () => {
      query = porTabla({
        system_domain_catalog: [DOMINIO],
        system_data_entity_catalog: [TABLA],
        system_data_field_catalog: [],
        system_endpoint_data_entity_impacts: [],
        system_data_relationship_catalog: [
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

      expect(ficha.relations).toHaveLength(1);
      expect(ficha.relations[0]).toMatchObject({
        relationId: 'fk:7',
        relationType: 'FOREIGN_KEY',
        targetId: 'customers',
        sourceTable: 'loans',
        targetColumn: '_id',
      });
    });

    it('sin claves foráneas se declara la relación documental, no una lista vacía', async () => {
      const ficha = await servicio(query).getBusinessTerm('table:10');

      expect(ficha.relations).toEqual([expect.objectContaining({ relationType: 'documents', targetType: 'table', targetId: 'loans' })]);
    });

    it('un identificador codificado en la URL se decodifica antes de buscar', async () => {
      const ficha = await servicio(query).getBusinessTerm(encodeURIComponent('domain:credit'));

      expect(ficha.termId).toBe('domain:credit');
    });

    it('la ficha lleva sus restricciones de gobierno, que no dependen del término', async () => {
      const ficha = await servicio(query).getBusinessTerm('domain:credit');

      expect(ficha.restrictions.join(' ')).toContain('PII');
      expect(ficha.audit).toEqual([expect.objectContaining({ auditId: 'audit:domain:credit', actor: 'atlas_backend' })]);
    });
  });
});
