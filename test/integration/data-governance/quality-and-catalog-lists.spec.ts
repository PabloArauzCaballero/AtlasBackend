/**
 * @file Listas de calidad de datos, catálogos, definiciones y políticas contra PostgreSQL real (WP2 2026-09-29).
 * @business Un filtro que no filtra o una cifra de página hace creer al operador que no hay incidencias críticas.
 * @system Siembra filas con un token único y ejercita el SQL real (UPPER, ILIKE escapado, DISTINCT ON,
 *   UNION ALL, conteos del filtro entero) que los dobles de las pruebas unitarias no pueden validar.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import {
  ContextCatalogModel,
  DataChangeLogModel,
  DataQualityIssueModel,
  DataQualityRuleModel,
  OperationalAuditLogModel,
  EventDefinitionModel,
  ObservationDefinitionModel,
  AttributeDefinitionModel,
  FeatureDefinitionModel,
} from '../../../src/database/models/index.js';
import { DataQualityRepository } from '../../../src/modules/data-quality/data-quality.repository.js';
import { DataQualityService } from '../../../src/modules/data-quality/data-quality.service.js';
import { PortalDataQualityService } from '../../../src/modules/internal-portal/application/portal-data-quality.service.js';
import { PortalOperationsService } from '../../../src/modules/internal-portal/application/portal-operations.service.js';
import { PortalReportsService } from '../../../src/modules/internal-portal/application/portal-reports.service.js';
import { listCatalogPage } from '../../../src/modules/catalog-management/catalog-list.query.js';
import { searchGovernancePolicies } from '../../../src/modules/catalog-management/catalog-governance-index.query.js';
import { CatalogDefinitionsRepository } from '../../../src/modules/catalog-management/catalog-definitions.repository.js';
import {
  definitionsQuerySchema,
  governancePolicySearchSchema,
  listCatalogsQuerySchema,
} from '../../../src/modules/catalog-management/catalog-list.schemas.js';
import { dataQualityQuerySchema } from '../../../src/modules/data-quality/data-quality.schemas.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let db: IntegrationDatabase | null = null;
const token = runToken();
const T = token.toUpperCase();
let tenantId = '';
const ruleIds: Record<string, string> = {};
const issueIds: Record<string, string> = {};

async function insert(sql: string, replacements: Record<string, unknown>): Promise<string> {
  const rows = await db!.sequelize.query<{ _id: string }>(`${sql} RETURNING _id`, { replacements, type: QueryTypes.SELECT });
  return String(rows[0]!._id);
}

beforeAll(async () => {
  db = await openIntegrationDatabase();
  if (!db) return;
  tenantId = await insert(`INSERT INTO tenants (_created_at) VALUES (NOW())`, {});
  // Severidades en minúscula, como la siembra: el filtro del portal manda MAYÚSCULAS.
  for (const [key, severity, active] of [
    ['crit', 'critical', true],
    ['high', 'HIGH', true],
    ['off', 'medium', false],
  ] as const) {
    ruleIds[key] = await insert(
      `INSERT INTO data_quality_rules (rule_code, rule_name, target_table, severity, is_active, _created_at)
       VALUES (:code, :name, :table, :severity, :active, NOW())`,
      { code: `DQ_${T}_${key.toUpperCase()}`, name: `Regla ${token} ${key}`, table: `wp2_${token}.t`, severity, active },
    );
  }
  const issue = (key: string, rule: string, status: string | null, table: string, notes: string | null, resolved = false) =>
    insert(
      `INSERT INTO data_quality_issues (_tenant_id, quality_rule_id, target_table, target_record_id, issue_status, detected_at, resolved_at, resolution_notes, _created_at)
       VALUES (:tenantId, :rule, :table, :rec, :status, NOW(), ${resolved ? 'NOW()' : 'NULL'}, :notes, NOW())`,
      { tenantId, rule, table, rec: key, status, notes },
    ).then((id) => (issueIds[key] = id));
  await issue('a', ruleIds.crit!, 'open', 'customer.customers', null);
  await issue('b', ruleIds.crit!, null, 'customer.customer_contact_methods', null);
  await issue('c', ruleIds.high!, 'acknowledged', 'partner.partner_profiles', 'Conocida: 100%_real');
  await issue('d', ruleIds.high!, 'resolved', 'customer.customers', 'corregido', true);
  await issue('e', ruleIds.off!, 'ignored', 'credit.loans', 'falso positivo', true);

  const catalog = (code: string, name: string, active: boolean) =>
    insert(
      `INSERT INTO context_catalogs (catalog_code, catalog_name, domain, owner_team, is_active, _created_at)
       VALUES (:code, :name, :domain, 'riesgo', :active, NOW())`,
      { code, name, domain: `dom_${token}`, active },
    );
  const version = (catalogId: string, status: string, validFrom: string) =>
    insert(
      `INSERT INTO context_catalog_versions (catalog_id, version_code, status, valid_from, _created_at)
       VALUES (:catalogId, :status, :status, :validFrom, NOW())`,
      { catalogId, status, validFrom },
    );
  const c1 = await catalog(`BANCOS_${T}`, 'Bancos', true);
  await version(c1, 'published', '2026-01-01');
  await version(c1, 'draft', '2026-06-01'); // la más reciente manda: c1 NO está publicado
  const c2 = await catalog(`MONEDA_${T}`, 'Monedas 50%', true);
  await version(c2, 'published', '2026-06-01');
  await catalog(`VACIO_${T}`, 'Sin versión', false);

  for (let i = 0; i < 3; i += 1) {
    await insert(
      `INSERT INTO event_definitions (event_code, event_name, is_active, review_status, _created_at) VALUES (:code, :name, true, 'NEEDS_REVIEW', NOW())`,
      { code: `evt_${token}_${i}`, name: `Evento ${i}` },
    );
    await insert(
      `INSERT INTO feature_definitions (feature_code, feature_name, is_active, review_status, _created_at) VALUES (:code, :name, true, 'NEEDS_REVIEW', NOW())`,
      { code: `feat_${token}_${i}`, name: `Feature ${i}` },
    );
  }
  await insert(
    `INSERT INTO privacy_processing_purposes (purpose_code, purpose_name, requires_explicit_consent, is_active, _created_at)
     VALUES (:code, 'Propósito de prueba', true, true, NOW())`,
    { code: `PUR_${T}` },
  );
});

afterAll(async () => {
  if (!db) return;
  const q = db.sequelize;
  await q.query(`DELETE FROM data_quality_issues WHERE _tenant_id = :tenantId`, { replacements: { tenantId } });
  await q.query(`DELETE FROM operational_audit_log WHERE _tenant_id = :tenantId`, { replacements: { tenantId } }).catch(() => undefined);
  await q.query(`DELETE FROM data_quality_rules WHERE rule_code LIKE :p`, { replacements: { p: `DQ_${T}_%` } });
  await q.query(`DELETE FROM context_catalog_versions WHERE catalog_id IN (SELECT _id FROM context_catalogs WHERE domain = :d)`, {
    replacements: { d: `dom_${token}` },
  });
  await q.query(`DELETE FROM context_catalogs WHERE domain = :d`, { replacements: { d: `dom_${token}` } });
  await q.query(`DELETE FROM event_definitions WHERE event_code LIKE :p`, { replacements: { p: `evt_${token}_%` } });
  await q.query(`DELETE FROM feature_definitions WHERE feature_code LIKE :p`, { replacements: { p: `feat_${token}_%` } });
  await q.query(`DELETE FROM privacy_processing_purposes WHERE purpose_code = :c`, { replacements: { c: `PUR_${T}` } });
  await db.close();
});

const scope = () => ({ tenantId, allTenants: false });
const repository = () =>
  new DataQualityRepository(DataQualityIssueModel, DataQualityRuleModel, OperationalAuditLogModel, DataChangeLogModel);
const issuesService = () => new DataQualityService(repository(), db!.sequelize);
const list = (query: Record<string, unknown>) => issuesService().listIssues(tenantId, dataQualityQuerySchema.parse(query));

describe('Issues de calidad contra Postgres', () => {
  it('severidad en MAYÚSCULAS encuentra reglas guardadas en minúscula (antes 0 filas)', async () => {
    const result = await list({ severity: 'CRITICAL' });
    expect(result.items.map((i) => i.entityId).sort()).toEqual(['a', 'b']);
    expect(result.items[0]?.severity).toBe('CRITICAL');
  });

  it('q busca en tabla, código de regla y notas, con % y _ literales', async () => {
    expect((await list({ q: 'contact_methods' })).items.map((i) => i.entityId)).toEqual(['b']);
    expect((await list({ q: `dq_${token}_high` })).items.map((i) => i.entityId).sort()).toEqual(['c', 'd']);
    expect((await list({ q: '100%_real' })).items.map((i) => i.entityId)).toEqual(['c']);
    // Sin escapar, `_` casaría con cualquier carácter: «customer_customers» encontraría «customer.customers».
    expect((await list({ q: 'customer_customers' })).items).toEqual([]);
  });

  it('status sin mayúsculas y la fila sin estado cuenta como open', async () => {
    expect((await list({ status: 'OPEN' })).items.map((i) => i.entityId).sort()).toEqual(['a', 'b']);
  });

  it('summary cuenta el filtro entero, no la página', async () => {
    const result = await list({ limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.summary).toMatchObject({ total: 5, pending: 3, unreviewed: 2, acknowledged: 1, closed: 2 });
  });
});

describe('Reglas de calidad, semáforo y reconocer contra Postgres', () => {
  it('filtra por severidad y estado, y summary cuenta críticas e incidencias pendientes del filtro', async () => {
    const service = new PortalDataQualityService(db!.sequelize);
    const all = await service.listDataQualityRules(scope(), { q: token, page: 1, limit: 1 });
    expect(all.meta.total).toBe(3);
    expect(all.items).toHaveLength(1);
    expect(all.items[0]?.severity).toBe('CRITICAL'); // orden por gravedad real
    // Pendientes: a, b (crit) + c (reconocida, high). d y e están cerradas.
    expect(all.summary).toEqual({ total: 3, critical: 1, active: 2, pendingIssues: 3 });
    const inactive = await service.listDataQualityRules(scope(), { q: token, status: 'INACTIVE', page: 1, limit: 20 });
    expect(inactive.items.map((r) => r.ruleCode)).toEqual([`DQ_${T}_OFF`]);
    const high = await service.listDataQualityRules(scope(), { q: token, severity: 'high', page: 1, limit: 20 });
    expect(high.items.map((r) => r.ruleCode)).toEqual([`DQ_${T}_HIGH`]);
    expect(high.items[0]?.openIssues).toBe(1);
  });

  it('el semáforo de salida cuenta como pendiente la reconocida y no la descartada', async () => {
    const reports = new PortalReportsService(db!.sequelize, new PortalOperationsService(db!.sequelize));
    const readiness = await reports.getReleaseReadiness(scope());
    const check = readiness.checks.find((c) => c.key === 'open_quality_issues');
    expect(check?.details).toEqual({ issues: 3 });
  });

  it('reconocer con motivo es idempotente, no cierra, y después se puede cerrar (antes 409)', async () => {
    const service = issuesService();
    const user = { role: 'internal_operator', internalUserId: null } as never;
    const body = { resolution: 'acknowledged', reasonCode: 'temporary_exception', notes: 'Proveedor caído' } as const;
    const input = { tenantId, params: { issueId: issueIds.a! }, body, currentUser: user, idempotencyKey: 'k' };
    await service.resolveIssue(input);
    await service.resolveIssue(input);
    const [row] = await db!.sequelize.query<{ issue_status: string; resolved_at: Date | null; resolution_notes: string }>(
      `SELECT issue_status, resolved_at, resolution_notes FROM data_quality_issues WHERE _id = :id`,
      { replacements: { id: issueIds.a }, type: QueryTypes.SELECT },
    );
    expect(row).toMatchObject({
      issue_status: 'acknowledged',
      resolved_at: null,
      resolution_notes: 'temporary_exception: Proveedor caído',
    });
    await service.resolveIssue({
      ...input,
      body: { resolution: 'resolved', reasonCode: 'source_validated', notes: 'Corregido en origen' },
    });
    const summary = (await list({})).summary;
    expect(summary).toMatchObject({ pending: 2, closed: 3 });
  });

  it('el antiguo reconocer tampoco duplica la nota y no reabre una cerrada', async () => {
    const operations = new PortalOperationsService(db!.sequelize);
    await operations.acknowledgeAlert(scope(), `dq:${issueIds.b}`);
    await operations.acknowledgeAlert(scope(), `dq:${issueIds.b}`);
    const [row] = await db!.sequelize.query<{ resolution_notes: string }>(
      `SELECT resolution_notes FROM data_quality_issues WHERE _id = :id`,
      { replacements: { id: issueIds.b }, type: QueryTypes.SELECT },
    );
    expect(row?.resolution_notes).toBe(' | Acknowledged from internal portal.');
    await expect(operations.acknowledgeAlert(scope(), `dq:${issueIds.d}`)).rejects.toThrow('DATA_QUALITY_ISSUE_ALREADY_RESOLVED');
  });
});

describe('Catálogos, definiciones y políticas contra Postgres', () => {
  it('catálogos: q con % literal, estado por la versión más reciente y summary del filtro', async () => {
    const page = (query: Record<string, unknown>) => listCatalogPage(ContextCatalogModel, listCatalogsQuerySchema.parse(query));
    const all = await page({ domain: `dom_${token}`, limit: 2 });
    expect(all.rows).toHaveLength(2);
    expect(all.summary).toEqual({ total: 3, active: 2, published: 1, withoutVersion: 1 });
    expect((await page({ domain: `dom_${token}`, status: 'published' })).rows.map((r) => r.catalogCode)).toEqual([`MONEDA_${T}`]);
    expect((await page({ domain: `dom_${token}`, status: 'draft' })).rows.map((r) => r.catalogCode)).toEqual([`BANCOS_${T}`]);
    expect((await page({ q: '50%', domain: `dom_${token}` })).rows.map((r) => r.catalogCode)).toEqual([`MONEDA_${T}`]);
  });

  it('definiciones: q en código y nombre, paginado a través de los tipos, conteo por tipo del filtro', async () => {
    const repo = new CatalogDefinitionsRepository(
      ObservationDefinitionModel,
      EventDefinitionModel,
      AttributeDefinitionModel,
      FeatureDefinitionModel,
    );
    const second = await repo.listDefinitions(definitionsQuerySchema.parse({ q: `_${token}_`, page: 2, limit: 4 }));
    expect(second.counts).toEqual({ events: 3, observations: 0, attributes: 0, features: 3 });
    expect(second.events).toEqual([]);
    expect(second.features.map((f) => f.featureCode)).toEqual([`feat_${token}_1`, `feat_${token}_2`]);
  });

  it('políticas: una sola lista paginada con tipo y q, summary del filtro', async () => {
    const result = await searchGovernancePolicies(db!.sequelize, governancePolicySearchSchema.parse({ q: T, limit: 20 }));
    const mine = result.items.filter((i) => String(i.code).includes(T));
    expect(mine.map((i) => i.type).sort()).toEqual(['purpose', 'quality', 'quality']);
    const purposes = await searchGovernancePolicies(db!.sequelize, governancePolicySearchSchema.parse({ q: `PUR_${T}`, type: 'purpose' }));
    expect(purposes.items).toEqual([expect.objectContaining({ code: `PUR_${T}`, policyId: expect.stringMatching(/^purpose:\d+$/) })]);
    expect(purposes.summary).toMatchObject({ total: 1, explicitConsent: 1, byType: { purpose: 1 } });
  });
});
