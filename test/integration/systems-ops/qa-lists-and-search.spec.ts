/**
 * @file Los filtros y buscadores de QA y la búsqueda global FILTRAN contra PostgreSQL real.
 * @business El portal ofrecía filtros que no filtraban (ambiente y perfil en corridas de estrés),
 *   buscadores que miraban otro campo (perfiles «por ruta del endpoint») y una búsqueda global que
 *   contaba 15 como máximo aunque hubiera más. Aquí se mide cada uno con filas que lo distinguen.
 * @system Postgres real: los filtros de `input_json` (JSONB), el `ILIKE` con comodines escapados y el
 *   `COUNT(*)` por tipo sólo se pueden dar por buenos contra la base, no contra un doble.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../../src/database/domain-schemas.js';
import {
  SystemEndpointCatalogModel,
  SystemJobRunModel,
  SystemStressProfileModel,
  SystemTestRunModel,
  SystemTestStepModel,
  SystemTestStepRunModel,
  SystemTestSuiteModel,
} from '../../../src/database/models/index.js';
import { PortalSearchService } from '../../../src/modules/internal-portal/application/portal-search.service.js';
import { SystemsStressProfileRepository } from '../../../src/modules/systems-ops/systems-stress-profile.repository.js';
import { SystemsStressRunService } from '../../../src/modules/systems-ops/systems-stress-run.service.js';
import { SystemsTestExecutionRepository } from '../../../src/modules/systems-ops/systems-test-execution.repository.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

const table = (name: string) => `${atlasSchemaFor(name)}.${name}`;
const JOB_RUNS = table('system_job_runs');
const SUITES = table('system_test_suites');
const RUNS = table('system_test_runs');
const ENDPOINTS = table('system_endpoint_catalog');
const PROFILES = table('system_stress_profiles');
const ENTITIES = table('system_data_entity_catalog');

let database: IntegrationDatabase | null = null;
const token = runToken().toLowerCase();
const platformUser = { role: 'system_admin', tenantId: null, internalUserId: 'wp6' } as never;
// Ids de perfil inventados y altos: las corridas se buscan dentro de `input_json`, sin FK.
const PROFILE_A = String(900_000_000 + Math.floor(Math.random() * 1_000_000));
const PROFILE_B = String(Number(PROFILE_A) + 1);

async function insert(sql: string, bind: Record<string, unknown>): Promise<string> {
  const rows = await database!.sequelize.query<{ _id: string }>(`${sql} RETURNING _id;`, { type: QueryTypes.SELECT, bind });
  return String(rows[0]._id);
}

async function insertStressRun(status: string, input: Record<string, unknown>): Promise<string> {
  return insert(
    `INSERT INTO ${JOB_RUNS} (_tenant_id, job_code, status, input_json, triggered_by_type, triggered_by_id, _created_at)
     VALUES (NULL, 'systems_stress_run', $status, $input, 'user', 'wp6', now())`,
    { status, input: JSON.stringify(input) },
  );
}

async function insertEndpoint(fullPath: string, suffix: string): Promise<string> {
  return insert(
    `INSERT INTO ${ENDPOINTS} (code, module, method, route_path, full_path, route_name, business_purpose, _created_at, _updated_at)
     VALUES ($code, 'wp6', 'GET', $path, $path, $name, 'prueba WP6', now(), now())`,
    { code: `WP6_${token}_${suffix}`.toUpperCase(), path: fullPath, name: `wp6 ${suffix}` },
  );
}

const stressRuns = () => new SystemsStressRunService(SystemStressProfileModel, SystemJobRunModel);
const testRepo = () =>
  new SystemsTestExecutionRepository(SystemTestSuiteModel, SystemTestStepModel, SystemTestRunModel, SystemTestStepRunModel);

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  await insertStressRun('completed', { profileId: PROFILE_A, profileCode: `P_${token}_A`, environment: 'STAGING' });
  await insertStressRun('queued', { profileId: PROFILE_A, profileCode: `P_${token}_A`, environment: 'LOCAL' });
  await insertStressRun('failed', { profileId: PROFILE_B, profileCode: `PX${token}_B`, environment: 'STAGING' });

  const suiteLogin = await insert(
    `INSERT INTO ${SUITES} (code, name, module, suite_type, _created_at, _updated_at) VALUES ($code, $name, $module, 'SMOKE', now(), now())`,
    { code: `WP6_${token}_LOGIN`.toUpperCase(), name: `Inicio de sesión ${token}`, module: `auth-${token}` },
  );
  await insert(
    `INSERT INTO ${SUITES} (code, name, module, suite_type, _created_at, _updated_at) VALUES ($code, 'Pagos', 'payments', 'LOAD', now(), now())`,
    { code: `WP6_${token}_PAY`.toUpperCase() },
  );
  await insert(
    `INSERT INTO ${RUNS} (suite_id, environment, status, _created_at, _updated_at) VALUES ($suite, 'STAGING', 'PASSED', now(), now())`,
    { suite: suiteLogin },
  );

  for (let index = 0; index < 17; index += 1) await insertEndpoint(`/wp6/${token}/ruta-${index}`, `E${index}`);
  const stressEndpoint = await insertEndpoint(`/wp6/${token}/carga-de-prestamos`, 'STRESS');
  await insert(
    `INSERT INTO ${PROFILES} (endpoint_id, code, name, target_rps, duration_seconds, concurrency, _created_at, _updated_at)
     VALUES ($endpoint, $code, 'Perfil sin la ruta en el nombre', 5, 30, 2, now(), now())`,
    { endpoint: stressEndpoint, code: `WP6_${token}_PROFILE`.toUpperCase() },
  );

  for (const name of [`t_${token}`, `tx${token}`]) {
    await insert(
      `INSERT INTO ${ENTITIES} (table_name, entity_name, module, business_purpose, _created_at, _updated_at)
       VALUES ($name, $name, 'wp6', 'prueba WP6', now(), now())`,
      { name },
    );
  }
});

afterAll(async () => {
  if (!database) return;
  const like = { like: `%${token}%` };
  await database.sequelize.query(`DELETE FROM ${JOB_RUNS} WHERE triggered_by_id = 'wp6' AND input_json->>'profileCode' ILIKE $like`, {
    bind: like,
  });
  await database.sequelize.query(`DELETE FROM ${RUNS} WHERE suite_id IN (SELECT _id FROM ${SUITES} WHERE code ILIKE $like)`, {
    bind: like,
  });
  await database.sequelize.query(`DELETE FROM ${SUITES} WHERE code ILIKE $like`, { bind: like });
  await database.sequelize.query(`DELETE FROM ${PROFILES} WHERE code ILIKE $like`, { bind: like });
  await database.sequelize.query(`DELETE FROM ${ENDPOINTS} WHERE code ILIKE $like`, { bind: like });
  await database.sequelize.query(`DELETE FROM ${ENTITIES} WHERE table_name ILIKE $like`, { bind: like });
  await database.close();
});

describe('corridas de estrés: filtros que filtran', () => {
  it('ambiente se aplica sobre input_json (antes devolvía también las LOCAL)', async () => {
    const result = await stressRuns().listStressRuns({ profileId: PROFILE_A, environment: 'STAGING', page: 1, limit: 20 }, platformUser);
    expect(result.meta.total).toBe(1);
    expect((result.items[0].inputJson as Record<string, unknown>).environment).toBe('STAGING');
  });

  it('el perfil filtra (y `suiteId`, su alias obsoleto, también)', async () => {
    const byProfile = await stressRuns().listStressRuns({ profileId: PROFILE_A, page: 1, limit: 20 }, platformUser);
    const byAlias = await stressRuns().listStressRuns({ suiteId: PROFILE_A, page: 1, limit: 20 }, platformUser);
    expect(byProfile.meta.total).toBe(2);
    expect(byAlias.meta.total).toBe(2);
  });

  it('PASSED encuentra las corridas `completed` de la cola', async () => {
    const result = await stressRuns().listStressRuns({ profileId: PROFILE_A, status: 'PASSED', page: 1, limit: 20 }, platformUser);
    expect(result.items.map((item) => item.status)).toEqual(['completed']);
  });

  it('la búsqueda por código de perfil toma `_` literal: P_ no casa con PX', async () => {
    const result = await stressRuns().listStressRuns({ q: `P_${token}`, page: 1, limit: 20 }, platformUser);
    expect(result.meta.total).toBe(2);
    expect(result.items.every((item) => (item.inputJson as Record<string, unknown>).profileId === PROFILE_A)).toBe(true);
  });
});

describe('suites y corridas de suite: el buscador viaja a la base', () => {
  it('suites: `q` busca en código, nombre y módulo', async () => {
    const byModule = await testRepo().listTestSuites({ q: `auth-${token}`, page: 1, limit: 20 });
    const byName = await testRepo().listTestSuites({ q: `sesión ${token}`, page: 1, limit: 20 });
    const byCode = await testRepo().listTestSuites({ q: `WP6_${token}`, page: 1, limit: 20 });
    expect(byModule.meta.total).toBe(1);
    expect(byName.meta.total).toBe(1);
    expect(byCode.meta.total).toBe(2);
  });

  it('corridas: `q` encuentra las corridas por el nombre de su suite', async () => {
    const found = await testRepo().listTestRuns({ q: `sesión ${token}`, page: 1, limit: 20 }, null);
    const none = await testRepo().listTestRuns({ q: `WP6_${token}_PAY`, page: 1, limit: 20 }, null);
    expect(found.meta.total).toBe(1);
    expect(none.meta.total).toBe(0);
  });
});

describe('perfiles de estrés: el buscador mira la ruta del endpoint, como promete', () => {
  it('encuentra el perfil por un trozo de la ruta que no está en su código ni en su nombre', async () => {
    const repo = new SystemsStressProfileRepository(SystemEndpointCatalogModel, SystemStressProfileModel);
    const result = await repo.listStressProfiles({ q: `${token}/carga-de`, page: 1, limit: 20 });
    expect(result.meta.total).toBe(1);
    expect(result.rows[0].code).toBe(`WP6_${token}_PROFILE`.toUpperCase());
  });
});

describe('búsqueda global: COUNT real y paginación por tipo', () => {
  it('cuenta los 18 endpoints aunque la página traiga 5, y la última página trae el resto', async () => {
    const search = new PortalSearchService(database!.sequelize);
    const first = await search.search({ q: `/wp6/${token}/`, kind: 'endpoint', page: 1, limit: 5 });
    expect(first.totals).toMatchObject({ endpoints: 18 });
    expect(first.items).toHaveLength(5);
    expect(first.meta).toEqual({ page: 1, limit: 5, total: 18, totalPages: 4 });
    const last = await search.search({ q: `/wp6/${token}/`, kind: 'endpoint', page: 4, limit: 5 });
    expect(last.items).toHaveLength(3);
  });

  it('escapa `_`: t_<token> no casa con tx<token>', async () => {
    const search = new PortalSearchService(database!.sequelize);
    const result = await search.search({ q: `t_${token}`, kind: 'table', page: 1, limit: 20 });
    expect(result.totals).toMatchObject({ tables: 1 });
  });
});
