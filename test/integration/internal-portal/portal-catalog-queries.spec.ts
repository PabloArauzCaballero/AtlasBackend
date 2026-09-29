/**
 * @file Los filtros y los totales del portal interno, medidos contra PostgreSQL real.
 * @business Un filtro que no filtra o un total calculado sobre un corte hacen que operaciones decida
 *   sobre datos que no son: estas pruebas demuestran que cada filtro DISTINGUE filas y que los totales
 *   cuentan el catálogo entero, no una página ni un `LIMIT` fijo.
 * @system Siembra un catálogo propio (dominios, tablas, campos, rutas, impactos y relaciones) marcado
 *   con un token por corrida, ejecuta los servicios reales del portal y borra lo sembrado al final.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { ReadQueryService } from '../../../src/common/database/read-query.service.js';
import { AdminReadService } from '../../../src/modules/internal-portal/application/admin-read.service.js';
import { PortalGlossaryService } from '../../../src/modules/internal-portal/application/portal-glossary.service.js';
import { PortalLineageImpactService } from '../../../src/modules/internal-portal/application/portal-lineage-impact.service.js';
import { PortalLineageService } from '../../../src/modules/internal-portal/application/portal-lineage.service.js';
import { SystemsCatalogSummaryService } from '../../../src/modules/systems-ops/systems-catalog-summary.service.js';
import { SystemsCatalogRepository } from '../../../src/modules/systems-ops/systems-catalog.repository.js';
import { SystemDataEntityCatalogModel, SystemEndpointCatalogModel } from '../../../src/database/models/index.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const token = `wp1${runToken()}`;
const DOMAIN = `DOM_${token}`.toUpperCase();
/** Más tablas que el antiguo `LIMIT 120` del glosario: la última sólo existe si no hay corte. */
const TABLE_COUNT = 125;
const ids = { tables: [] as string[], endpoints: [] as string[] };

async function insert(sql: string, bind: Record<string, unknown>): Promise<string> {
  const rows = await database!.sequelize.query<{ _id: string }>(`${sql} RETURNING _id::text AS _id`, { bind, type: QueryTypes.SELECT });
  return rows[0]!._id;
}

async function seed(): Promise<void> {
  await database!.sequelize.query(
    `INSERT INTO system_domain_catalog (domain_code, domain_name, description, business_definition, technical_scope, data_nature, owner_team, audit_relevance)
     VALUES ($1, 'Dominio de prueba', 'Dominio sembrado', 'def', 'scope', 'OPERACIONAL', 'equipo', 'audit')`,
    { bind: [DOMAIN] },
  );
  for (let index = 0; index < TABLE_COUNT; index += 1) {
    const personal = index === 0;
    ids.tables.push(
      await insert(
        `INSERT INTO system_data_entity_catalog (schema_name, table_name, entity_name, module, business_purpose, domain_code, data_owner, contains_pii)
         VALUES ('wp1', $name, $entity, $module, $purpose, $domain, $owner, $pii)`,
        {
          name: `${token}_t${String(index).padStart(3, '0')}`,
          entity: `Entidad ${index}`,
          module: `mod_${token}`,
          purpose: index % 2 === 0 ? 'Para algo' : '',
          domain: index < 3 ? DOMAIN : null,
          owner: index === 1 ? `dueno_${token}` : 'systems',
          pii: personal,
        },
      ),
    );
  }
  await database!.sequelize.query(
    `INSERT INTO system_data_field_catalog (data_entity_id, schema_name, table_name, column_name, sql_data_type, business_name, business_meaning,
       technical_meaning, why_store, audit_usage, analysis_usage, decision_usage, backend_write_behavior, ordinal_position)
     VALUES ($1, 'wp1', $2, 'monto_total', 'numeric', 'Monto', 'm', 't', 'w', 'a', 'a', 'd', 'b', 1)`,
    { bind: [ids.tables[0], `${token}_t000`] },
  );
  for (const [index, risk] of ['LOW', 'HIGH'].entries()) {
    ids.endpoints.push(
      await insert(
        `INSERT INTO system_endpoint_catalog (code, module, method, route_path, full_path, route_name, business_purpose, risk_level, pii_fields, contains_pii)
         VALUES ($code, $module, 'GET', $path, $path, $name, 'propósito', $risk, $fields::jsonb, false)`,
        {
          code: `${token}_E${index}`.toUpperCase(),
          module: `mod_${token}`,
          path: `/wp1/${token}/r${index}`,
          name: `${token}.r${index}`,
          risk,
          fields: index === 1 ? '["email"]' : '[]',
        },
      ),
    );
  }
  await database!.sequelize.query(
    `INSERT INTO system_endpoint_data_entity_impacts (endpoint_id, data_entity_id, operation_type, impact_level, notes)
     VALUES ($1, $3, 'READ', 'LOW', 'lee'), ($2, $4, 'UPDATE', 'CRITICAL', 'escribe')`,
    { bind: [ids.endpoints[0], ids.endpoints[1], ids.tables[0], ids.tables[124]] },
  );
  await database!.sequelize.query(
    `INSERT INTO system_data_relationship_catalog (source_schema, source_table, target_schema, target_table, relationship_type, cardinality,
       business_reason, technical_reason, audit_usage, analysis_usage, decision_usage)
     VALUES ('wp1', $1, 'wp1', $2, 'FOREIGN_KEY', 'N:1', 'texto libre de negocio', 't', 'a', 'a', 'd')`,
    { bind: [`${token}_t001`, `${token}_t000`] },
  );
}

async function cleanup(): Promise<void> {
  const q = database!.sequelize;
  await q.query(`DELETE FROM system_data_relationship_catalog WHERE source_table LIKE $1`, { bind: [`${token}%`] });
  await q.query(`DELETE FROM system_endpoint_data_entity_impacts WHERE endpoint_id::text = ANY($1)`, { bind: [ids.endpoints] });
  await q.query(`DELETE FROM system_data_field_catalog WHERE table_name LIKE $1`, { bind: [`${token}%`] });
  await q.query(`DELETE FROM system_endpoint_catalog WHERE module = $1`, { bind: [`mod_${token}`] });
  await q.query(`DELETE FROM system_data_entity_catalog WHERE module = $1`, { bind: [`mod_${token}`] });
  await q.query(`DELETE FROM system_domain_catalog WHERE domain_code = $1`, { bind: [DOMAIN] });
}

let summaryBefore: Awaited<ReturnType<SystemsCatalogSummaryService['summary']>>;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  summaryBefore = await new SystemsCatalogSummaryService(database.sequelize).summary();
  await seed();
});

afterAll(async () => {
  if (!database) return;
  await cleanup();
  await database.close();
});

const glossary = () => new PortalGlossaryService(database!.sequelize);
const impact = () => new PortalLineageImpactService(database!.sequelize);

describe('glosario en SQL', () => {
  it('el total cuenta el catálogo entero: 125 tablas y no las 120 del antiguo LIMIT', async () => {
    const page = await glossary().listBusinessTerms({ q: token, type: 'table', page: 7, limit: 20 });
    expect(page.meta.total).toBe(TABLE_COUNT);
    expect(page.items.map((item) => item.key)).toEqual(Array.from({ length: 5 }, (_, i) => `${token}_t${120 + i}`));
  });

  it('`domain` filtra: trae el dominio, sus tres tablas y el campo, y nada más', async () => {
    const page = await glossary().listBusinessTerms({ domain: DOMAIN.toLowerCase(), page: 1, limit: 50 });
    expect(page.items.map((item) => item.type)).toEqual(['domain', 'table', 'table', 'table', 'field']);
    expect(page.items[0]).toMatchObject({ termId: `domain:${DOMAIN}`, relatedTables: [`${token}_t000`, `${token}_t001`, `${token}_t002`] });
  });

  it('el buscador mira el dueño y escapa los comodines', async () => {
    const byOwner = await glossary().listBusinessTerms({ q: `dueno_${token}`, page: 1, limit: 10 });
    expect(byOwner.items.map((item) => item.key)).toEqual([`${token}_t001`]);
    const wildcard = await glossary().listBusinessTerms({ q: `${token}%t12`, page: 1, limit: 10 });
    expect(wildcard.meta.total).toBe(0);
  });

  it('la ficha de la tabla 125 existe (antes: 404 por quedar fuera de las 120)', async () => {
    const term = await glossary().getBusinessTerm(`table:${ids.tables[124]}`);
    expect(term).toMatchObject({ key: `${token}_t124`, relatedEndpoints: [`GET /wp1/${token}/r1`] });
  });

  it('los valores del filtro de dominio salen del catálogo entero con su número de términos', async () => {
    const facets = await glossary().listBusinessTermFacets();
    expect(facets.domains).toContainEqual({ value: DOMAIN, total: 5 });
  });
});

describe('impacto de linaje en SQL', () => {
  it('`severity` filtra y el resumen cuenta todo lo filtrado', async () => {
    const all = await impact().getLineageImpact({ q: token, page: 1, limit: 20 });
    expect(all.meta.total).toBe(3);
    expect(all.summary).toEqual({ bySeverity: { LOW: 1, MEDIUM: 0, HIGH: 0, CRITICAL: 1 }, byFamily: { impact: 2, relationship: 1 } });

    const critical = await impact().getLineageImpact({ q: token, severity: 'critical', page: 1, limit: 20 });
    expect(critical.items.map((item) => item.impactType)).toEqual(['UPDATE']);
    expect(critical.meta.total).toBe(1);
  });

  it('la relación entre tablas no lleva severidad; su texto va a la descripción', async () => {
    const rel = await impact().getLineageImpact({ q: token, family: 'relationship', page: 1, limit: 20 });
    expect(rel.items).toEqual([expect.objectContaining({ family: 'relationship', severity: null, description: 'texto libre de negocio' })]);
  });

  it('la ficha de un nodo trae sus aristas sin depender del recorte del grafo', async () => {
    const node = await impact().getLineageNode(`table:${ids.tables[0]}`);
    expect(node.incomingEdges.map((edge) => edge.edgeType).sort()).toEqual(['FOREIGN_KEY', 'READ']);
  });

  it('el grafo filtra por módulo y declara el total que cumple el filtro', async () => {
    const graph = await new PortalLineageService(database!.sequelize).getLineage({ domain: `MOD_${token}`, nodeLimit: 100 });
    expect(graph.summary.tables).toMatchObject({ shown: 100, total: TABLE_COUNT });
    expect(graph.summary.endpoints).toMatchObject({ shown: 2, total: 2 });
    expect(graph.summary.truncated).toBe(true);
  });
});

describe('catálogo de sistemas', () => {
  it('`personalData` y el buscador por responsable filtran en la base', async () => {
    // Sólo los dos modelos que usan los listados; el resto de colaboradores no interviene aquí.
    const unused = undefined as never;
    const repository = new SystemsCatalogRepository(
      SystemEndpointCatalogModel,
      unused,
      unused,
      SystemDataEntityCatalogModel,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
    const personal = await repository.listDataEntities({ module: `mod_${token}`, personalData: true, page: 1, limit: 50 } as never);
    expect(personal.meta.total).toBe(1);
    const byOwner = await repository.listDataEntities({ q: `dueno_${token}`, page: 1, limit: 50 } as never);
    expect(byOwner.meta.total).toBe(1);
    const routes = await repository.listEndpoints({ module: `mod_${token}`, personalData: true, page: 1, limit: 50 } as never);
    expect(routes.rows.map((row) => row.riskLevel)).toEqual(['HIGH']);
  });

  it('el resumen cuenta las filas sembradas en cada familia', async () => {
    const after = await new SystemsCatalogSummaryService(database!.sequelize).summary();
    expect(after.tables.total - summaryBefore.tables.total).toBe(TABLE_COUNT);
    expect(after.tables.withPurpose - summaryBefore.tables.withPurpose).toBe(63);
    expect(after.tables.personalData - summaryBefore.tables.personalData).toBe(1);
    expect(after.endpoints.personalData - summaryBefore.endpoints.personalData).toBe(1);
    expect(after.endpoints.highOrCritical - summaryBefore.endpoints.highOrCritical).toBe(1);
  });

  it('la vista de cobertura de rutas busca con `q` y publica sus valores de filtro', async () => {
    const views = new AdminReadService(new ReadQueryService(database!.sequelize));
    const found = await views.listEndpointCoverage({ page: 1, limit: 10, q: `/wp1/${token}/r1` } as never);
    expect(found.meta.total).toBe(1);
    const facets = await views.listFacets('endpoint-coverage');
    expect(facets.facets.module).toContain(`mod_${token}`);
  });
});
