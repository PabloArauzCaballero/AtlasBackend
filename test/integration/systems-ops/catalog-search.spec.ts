/**
 * @file Los buscadores de Systems Ops buscan de verdad, en PostgreSQL real.
 * @business La cola de revisión del catálogo, el inventario de esquema, el change log y la auditoría
 *   prometían un buscador que no buscaba (un módulo exacto, un ID numérico, un Request ID). Estas
 *   pruebas fijan que el texto encuentra lo que la tabla enseña y NADA más: con datos que distinguen.
 * @system Inserta filas con un token por corrida, consulta con los repositorios reales y borra al
 *   terminar. El `_` del token es a propósito: sin escapar, `ILIKE` lo trata como comodín y casaba
 *   con la fila vecina (`rutaX…`), que es la prueba en negativo del escape.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../../src/database/domain-schemas.js';
import {
  SystemActionLogModel,
  SystemCatalogReviewEventModel,
  SystemDataEntityCatalogModel,
  SystemDataFieldCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointToolRequirementModel,
} from '../../../src/database/models/index.js';
import { SchemaChangeLogRepository } from '../../../src/modules/schema-management/schema-change-log.repository.js';
import { SchemaManagementRepository } from '../../../src/modules/schema-management/schema-management.repository.js';
import { SystemsActionLogRepository } from '../../../src/modules/systems-ops/systems-action-log.repository.js';
import { SystemsReviewRepository } from '../../../src/modules/systems-ops/systems-review.repository.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

const T = (table: string) => `${atlasSchemaFor(table)}.${table}`;

let db: IntegrationDatabase | null = null;
const tok = runToken().slice(-10);
const ids: Record<string, string> = {};

async function insert(table: string, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values);
  const rows = await db!.sequelize.query<{ _id: string }>(
    `INSERT INTO ${T(table)} (${columns.join(', ')}) VALUES (${columns.map((c) => `:${c}`).join(', ')}) RETURNING _id`,
    { type: QueryTypes.SELECT, replacements: values },
  );
  return String(rows[0]!._id);
}

const endpoint = (code: string, path: string, module: string) =>
  insert('system_endpoint_catalog', {
    code,
    module,
    method: 'GET',
    route_path: path,
    full_path: path,
    route_name: code,
    business_purpose: 'prueba de búsqueda',
    handler_name: `handler${code}`,
    review_status: 'NEEDS_REVIEW',
  });

function reviewRepository() {
  return new SystemsReviewRepository(
    SystemEndpointCatalogModel,
    SystemDataEntityCatalogModel,
    SystemEndpointDataEntityImpactModel,
    SystemEndpointFieldImpactModel,
    SystemDataFieldCatalogModel,
    SystemEndpointToolRequirementModel,
    SystemCatalogReviewEventModel,
  );
}

const queue = (over: Record<string, unknown>) =>
  reviewRepository().listReviewQueue({ type: 'all', reviewStatus: 'NEEDS_REVIEW', page: 1, limit: 20, ...over } as never);

beforeAll(async () => {
  db = await openIntegrationDatabase();
  if (!db) return;
  ids.e1 = await endpoint(`it-${tok}-cuotas`, `/v1/ruta_${tok}/cuotas`, `mod${tok}`);
  ids.e2 = await endpoint(`it-${tok}-otro`, `/v1/rutaX${tok}/otro`, `otro${tok}`);
  ids.d1 = await insert('system_data_entity_catalog', {
    table_name: `tabla${tok}`,
    entity_name: `Entidad ${tok}`,
    module: `mod${tok}`,
    business_purpose: 'prueba',
    review_status: 'NEEDS_REVIEW',
  });
  ids.i1 = await insert('system_endpoint_data_entity_impacts', {
    endpoint_id: ids.e1,
    data_entity_id: ids.d1,
    operation_type: 'READ',
    review_status: 'NEEDS_REVIEW',
  });
  ids.i2 = await insert('system_endpoint_data_entity_impacts', {
    endpoint_id: ids.e2,
    data_entity_id: ids.d1,
    operation_type: 'UPDATE',
    review_status: 'NEEDS_REVIEW',
  });
  ids.f1 = await insert('system_endpoint_field_impacts', {
    endpoint_id: ids.e1,
    data_entity_id: ids.d1,
    field_name: 'monto',
    field_operation: 'READ',
    review_status: 'NEEDS_REVIEW',
  });
  ids.t1 = await insert('system_tool_catalog', {
    code: `tool${tok}`,
    name: 'Herramienta',
    type: 'EXTERNAL',
    purpose: 'prueba',
    provider: `Proveedor${tok}`,
  });
  ids.r1 = await insert('system_endpoint_tool_requirements', {
    endpoint_id: ids.e2,
    tool_id: ids.t1,
    usage_type: 'CALL',
    review_status: 'NEEDS_REVIEW',
  });
  const texto = 'prueba';
  ids.c1 = await insert('system_data_field_catalog', {
    data_entity_id: ids.d1,
    schema_name: 'public',
    table_name: `tabla${tok}`,
    column_name: 'saldo',
    sql_data_type: 'numeric',
    business_name: 'Saldo',
    business_meaning: texto,
    technical_meaning: texto,
    why_store: texto,
    audit_usage: texto,
    analysis_usage: texto,
    decision_usage: texto,
    backend_write_behavior: texto,
    review_status: 'NEEDS_REVIEW',
  });
});

afterAll(async () => {
  if (!db) return;
  const del = (table: string, keys: string[]) =>
    db!.sequelize.query(`DELETE FROM ${T(table)} WHERE _id IN (:ids)`, { replacements: { ids: keys.map((k) => ids[k]).filter(Boolean) } });
  await del('system_endpoint_tool_requirements', ['r1']);
  await del('system_endpoint_field_impacts', ['f1']);
  await del('system_endpoint_data_entity_impacts', ['i1', 'i2']);
  await del('system_data_field_catalog', ['c1']);
  await del('system_tool_catalog', ['t1']);
  await del('system_data_entity_catalog', ['d1']);
  await del('system_endpoint_catalog', ['e1', 'e2']);
  await db.close();
});

describe('cola de revisión del catálogo: `q` y `module` en las seis familias', () => {
  it('el texto de una ruta encuentra la ruta, y sus impactos aunque la fila sólo guarde IDs', async () => {
    if (!db) return;
    const r = await queue({ q: `ruta_${tok}` });
    expect(r.endpoints.rows.map((row) => String(row.id))).toEqual([ids.e1]);
    expect(r.dataImpacts.rows.map((row) => String(row.id))).toEqual([ids.i1]);
    expect(r.fieldImpacts.rows.map((row) => String(row.id))).toEqual([ids.f1]);
    // Negativo del escape: sin él, `ruta_` casaba también con `rutaX` y salían e2 e i2.
    expect(r.dataImpacts.count).toBe(1);
  });

  it('el proveedor de una herramienta encuentra el requisito que la usa', async () => {
    if (!db) return;
    const r = await queue({ q: `proveedor${tok}` });
    expect(r.toolRequirements.rows.map((row) => String(row.id))).toEqual([ids.r1]);
    expect(r.endpoints.count).toBe(0);
  });

  it('el nombre de una tabla encuentra la tabla, sus columnas y todos sus impactos', async () => {
    if (!db) return;
    const r = await queue({ q: `tabla${tok}` });
    expect(r.dataEntities.rows.map((row) => String(row.id))).toEqual([ids.d1]);
    expect(r.dataColumns.rows.map((row) => String(row.id))).toEqual([ids.c1]);
    expect(r.dataImpacts.rows.map((row) => String(row.id)).sort()).toEqual([ids.i1, ids.i2].sort());
  });

  it('el módulo filtra también impactos, columnas y requisitos (antes se ignoraba en cuatro familias)', async () => {
    if (!db) return;
    const r = await queue({ module: `mod${tok}` });
    expect(r.dataImpacts.rows.map((row) => String(row.id))).toEqual([ids.i1]);
    expect(r.dataColumns.rows.map((row) => String(row.id))).toEqual([ids.c1]);
    expect(r.toolRequirements.count).toBe(0);
  });

  it('pagina de verdad: con límite 1, la segunda página trae la otra fila y el total es el de todas', async () => {
    if (!db) return;
    const p1 = await queue({ type: 'endpoints', q: `it-${tok}`, limit: 1, page: 1 });
    const p2 = await queue({ type: 'endpoints', q: `it-${tok}`, limit: 1, page: 2 });
    expect(p1.endpoints.count).toBe(2);
    expect(p1.endpoints.rows).toHaveLength(1);
    expect(p2.endpoints.rows).toHaveLength(1);
    expect(String(p1.endpoints.rows[0]!.id)).not.toBe(String(p2.endpoints.rows[0]!.id));
  });
});

describe('inventario y change log de esquema: `q`', () => {
  const created: Record<string, string> = {};

  beforeAll(async () => {
    if (!db) return;
    created.version = await insert('schema_versions', { version_code: `v${tok}`, notes: `notas ${tok}` });
    created.t1 = await insert('schema_tables', { schema_version_id: created.version, table_name: `risk.alpha_${tok}` });
    created.t2 = await insert('schema_tables', { schema_version_id: created.version, table_name: `risk.alphaX${tok}` });
    const tenant = await db.sequelize.query<{ _id: string }>(`INSERT INTO iam.tenants (_created_at) VALUES (now()) RETURNING _id`, {
      type: QueryTypes.SELECT,
    });
    created.tenant = String(tenant[0]!._id);
    const user = await db.sequelize.query<{ _id: string }>(
      `INSERT INTO iam.internal_users (_tenant_id, _created_at) VALUES (:tenant, now()) RETURNING _id`,
      { type: QueryTypes.SELECT, replacements: { tenant: created.tenant } },
    );
    created.user = String(user[0]!._id);
    const changeLog = new SchemaChangeLogRepository(db.sequelize);
    for (const tableName of [`cuentas_${tok}`, `cuentasX${tok}`]) {
      const row = await changeLog.createChangeLogEntry({
        changeType: 'CREATE_TABLE',
        affectedEntityType: 'TABLE',
        changePayload: { tableName },
        requesterPlatformUserId: null,
        requesterInternalUserId: created.user,
      } as never);
      created[tableName] = String(row._id);
    }
  });

  afterAll(async () => {
    if (!db) return;
    await db.sequelize.query(`DELETE FROM ${T('schema_change_log')} WHERE requester_internal_user_id = :user`, {
      replacements: { user: created.user },
    });
    await db.sequelize.query(`DELETE FROM ${T('schema_tables')} WHERE schema_version_id = :v`, { replacements: { v: created.version } });
    await db.sequelize.query(`DELETE FROM ${T('schema_versions')} WHERE _id = :v`, { replacements: { v: created.version } });
    await db.sequelize.query(`DELETE FROM iam.internal_users WHERE _id = :u`, { replacements: { u: created.user } });
    await db.sequelize.query(`DELETE FROM iam.tenants WHERE _id = :t`, { replacements: { t: created.tenant } });
  });

  it('tablas: busca por nombre cualificado con el `_` escapado', async () => {
    if (!db) return;
    const repo = new SchemaManagementRepository(db.sequelize);
    const found = await repo.listSchemaTables(created.version!, undefined, 50, 0, { q: `alpha_${tok}` });
    expect(found.rows.map((row) => String(row._id))).toEqual([created.t1]);
    expect(found.total).toBe(1);
    const all = await repo.listSchemaTables(created.version!, undefined, 50, 0);
    expect(all.total).toBe(2);
  });

  it('versiones: busca por código o notas', async () => {
    if (!db) return;
    const repo = new SchemaManagementRepository(db.sequelize);
    const found = await repo.listSchemaVersions(20, 0, true, `notas ${tok}`);
    expect(found.rows.map((row) => String(row._id))).toEqual([created.version]);
    expect((await repo.listSchemaVersions(20, 0, true, `nada${tok}`)).total).toBe(0);
  });

  it('change log: busca por la tabla propuesta (antes sólo por ID numérico, y una letra daba 400)', async () => {
    if (!db) return;
    const repo = new SchemaChangeLogRepository(db.sequelize);
    const found = await repo.listChangeLog({ requesterUserId: created.user, q: `cuentas_${tok}` }, 50, 0);
    expect(found.rows.map((row) => String(row._id))).toEqual([created[`cuentas_${tok}`]]);
    const porTipo = await repo.listChangeLog({ requesterUserId: created.user, q: 'create_table' }, 50, 0);
    expect(porTipo.total).toBe(2);
  });
});

describe('auditoría: `q` y el corte del informe de tráfico', () => {
  const created: string[] = [];

  beforeAll(async () => {
    if (!db) return;
    for (const [route, role] of [
      [`/v1/rep_${tok}/:id`, `rol${tok}`],
      [`/v1/repX${tok}/:id`, 'otro'],
      [`/v1/tercera${tok}`, 'otro'],
    ]) {
      created.push(
        await insert('system_action_logs', {
          method: 'GET',
          route_template: route,
          resolved_url_sanitized: route.replace(':id', '1'),
          actor_role: role,
          duration_ms: 10,
          response_status_code: 200,
          occurred_at: new Date(),
        }),
      );
    }
  });

  afterAll(async () => {
    if (!db || !created.length) return;
    await db.sequelize.query(`DELETE FROM ${T('system_action_logs')} WHERE _id IN (:ids)`, { replacements: { ids: created } });
  });

  it('la bitácora busca en la ruta y en el rol del actor', async () => {
    if (!db) return;
    const repo = new SystemsActionLogRepository(SystemActionLogModel, db.sequelize);
    const porRuta = await repo.listActionLogs({ q: `rep_${tok}`, page: 1, limit: 20 } as never, null);
    expect(porRuta.rows.map((row) => String(row.id))).toEqual([created[0]]);
    const porRol = await repo.listActionLogs({ q: `ROL${tok}`, page: 1, limit: 20 } as never, null);
    expect(porRol.rows.map((row) => String(row.id))).toEqual([created[0]]);
  });

  it('el informe de tráfico dice cuántas rutas hubo en total, no sólo las que enseña', async () => {
    if (!db) return;
    const repo = new SystemsActionLogRepository(SystemActionLogModel, db.sequelize);
    const rows = await repo.getTrafficLatencyByRoute(new Date(Date.now() - 3_600_000), null);
    const distintas = await db.sequelize.query<{ n: string }>(
      `SELECT COUNT(DISTINCT (route_template, method))::text AS n FROM ${T('system_action_logs')}
        WHERE occurred_at >= now() - interval '1 hour' AND duration_ms IS NOT NULL`,
      { type: QueryTypes.SELECT },
    );
    expect(Number(rows[0]!.routes_total)).toBe(Number(distintas[0]!.n));
    expect(Number(rows[0]!.routes_total)).toBeGreaterThanOrEqual(3);
  });
});

describe('informe de tráfico: buscar, filtrar y paginar rutas sin tocar los totales de la ventana', () => {
  const created: string[] = [];
  const RUTAS: Array<[string, string, number]> = [
    ['GET', `/v1/tf_${tok}/lista`, 3],
    ['POST', `/v1/tf_${tok}/lista`, 2],
    ['GET', `/v1/tfX${tok}/otra`, 1],
    ['DELETE', `/v1/tf_${tok}/borrar`, 1],
  ];

  beforeAll(async () => {
    if (!db) return;
    for (const [method, route, veces] of RUTAS) {
      for (let i = 0; i < veces; i += 1) {
        created.push(
          await insert('system_action_logs', {
            method,
            route_template: route,
            resolved_url_sanitized: route,
            duration_ms: 10 + i,
            response_status_code: 200,
            occurred_at: new Date(),
          }),
        );
      }
    }
  });

  afterAll(async () => {
    if (!db || !created.length) return;
    await db.sequelize.query(`DELETE FROM ${T('system_action_logs')} WHERE _id IN (:ids)`, { replacements: { ids: created } });
  });

  const desde = () => new Date(Date.now() - 3_600_000);
  const rutasDe = (rows: Array<{ method: string; route_template: string | null; route_present?: boolean }>) =>
    rows.filter((row) => row.route_present !== false).map((row) => `${row.method} ${row.route_template}`);

  it('el buscador encuentra por ruta y trata `_` como texto: «tf_» no casa con «tfX»', async () => {
    if (!db) return;
    const repo = new SystemsActionLogRepository(SystemActionLogModel, db.sequelize);
    const rows = await repo.getTrafficLatencyByRoute(desde(), null, { q: `tf_${tok}`, limit: 50 });
    // Sin escapar el guion bajo, `tfX…` también saldría. Ordenadas por peticiones y, a igualdad, por ruta.
    expect(rutasDe(rows)).toEqual([`GET /v1/tf_${tok}/lista`, `POST /v1/tf_${tok}/lista`, `DELETE /v1/tf_${tok}/borrar`]);
    expect(Number(rows[0]!.routes_matching)).toBe(3);
  });

  it('el método acota la tabla', async () => {
    if (!db) return;
    const repo = new SystemsActionLogRepository(SystemActionLogModel, db.sequelize);
    const soloPost = await repo.getTrafficLatencyByRoute(desde(), null, { q: `tf_${tok}`, method: 'POST', limit: 50 });
    expect(rutasDe(soloPost)).toEqual([`POST /v1/tf_${tok}/lista`]);
    const busquedaPorMetodo = await repo.getTrafficLatencyByRoute(desde(), null, { q: `delete`, limit: 50 });
    expect(rutasDe(busquedaPorMetodo).every((ruta) => ruta.startsWith('DELETE '))).toBe(true);
  });

  it('la página corta las coincidencias y `routes_matching` sigue contando todas', async () => {
    if (!db) return;
    const repo = new SystemsActionLogRepository(SystemActionLogModel, db.sequelize);
    const p1 = await repo.getTrafficLatencyByRoute(desde(), null, { q: `tf_${tok}`, limit: 2, offset: 0 });
    const p2 = await repo.getTrafficLatencyByRoute(desde(), null, { q: `tf_${tok}`, limit: 2, offset: 2 });
    expect(rutasDe(p1)).toEqual([`GET /v1/tf_${tok}/lista`, `POST /v1/tf_${tok}/lista`]);
    expect(rutasDe(p2)).toEqual([`DELETE /v1/tf_${tok}/borrar`]);
    expect(Number(p1[0]!.routes_matching)).toBe(3);
    expect(Number(p2[0]!.routes_matching)).toBe(3);
  });

  it('buscar no cambia los totales de la ventana, ni siquiera cuando no encuentra nada', async () => {
    if (!db) return;
    const repo = new SystemsActionLogRepository(SystemActionLogModel, db.sequelize);
    const todo = await repo.getTrafficLatencyByRoute(desde(), null);
    const acotado = await repo.getTrafficLatencyByRoute(desde(), null, { q: `tf_${tok}`, limit: 1 });
    const nada = await repo.getTrafficLatencyByRoute(desde(), null, { q: `nada_${tok}`, limit: 20 });
    for (const rows of [acotado, nada]) {
      expect(rows[0]!.overall_total_requests).toBe(todo[0]!.overall_total_requests);
      expect(rows[0]!.overall_error_count).toBe(todo[0]!.overall_error_count);
      expect(rows[0]!.routes_total).toBe(todo[0]!.routes_total);
    }
    // Sin coincidencias queda UNA fila con los totales y sin ruta, no una lista vacía que borre el resumen.
    expect(nada).toHaveLength(1);
    expect(nada[0]!.route_present).toBe(false);
    expect(Number(nada[0]!.routes_matching)).toBe(0);
  });

  it('sin buscador ni límite se comporta como antes: las rutas con más peticiones, hasta 50', async () => {
    if (!db) return;
    const repo = new SystemsActionLogRepository(SystemActionLogModel, db.sequelize);
    const rows = await repo.getTrafficLatencyByRoute(desde(), null);
    expect(rows.length).toBeLessThanOrEqual(50);
    const pesos = rows.map((row) => Number(row.total_requests));
    expect([...pesos].sort((a, b) => b - a)).toEqual(pesos);
    expect(Number(rows[0]!.routes_matching)).toBe(Number(rows[0]!.routes_total));
  });
});
