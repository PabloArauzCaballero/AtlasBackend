import { getArrayFromPaths, getStringFromPaths, logSmokeConfig, request, TENANT_ID } from './http.js';

type JsonRecord = Record<string, unknown>;

type AuthContext = { headers: Record<string, string> };

const PABLO_EMAIL = process.env.INTERNAL_SMOKE_EMAIL ?? 'pablo@atlas.internal';
const PABLO_PASSWORD = process.env.INTERNAL_SMOKE_PASSWORD ?? 'Atlas72107014!';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function getItems(value: unknown, label: string): JsonRecord[] {
  const items = getArrayFromPaths<JsonRecord>(value, [
    ['data', 'items'],
    ['items'],
    ['data', 'data', 'items'],
  ]);
  assert(items.length > 0, `${label} devolvió items vacío. Esto no debe fallar silenciosamente.`);
  return items;
}

function firstId(items: JsonRecord[], keys: string[], label: string): string {
  for (const key of keys) {
    const value = items[0]?.[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  throw new Error(`${label} no tiene identificador válido en ${keys.join(', ')}: ${JSON.stringify(items[0])}`);
}

async function login(): Promise<AuthContext> {
  const response = await request<JsonRecord>({
    method: 'POST',
    path: '/internal/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { tenantId: TENANT_ID, email: PABLO_EMAIL, password: PABLO_PASSWORD },
    expected: [200],
  });
  const token = getStringFromPaths(response.data, [['data', 'accessToken'], ['accessToken']]);
  assert(token.length > 20, 'Login no devolvió accessToken útil.');
  return { headers: { authorization: `Bearer ${token}` } };
}

async function expectNonEmptyGet(ctx: AuthContext, path: string, label: string): Promise<JsonRecord[]> {
  const response = await request<JsonRecord>({ method: 'GET', path, extraHeaders: ctx.headers, expected: [200] });
  return getItems(response.data, label);
}

async function expectOk(ctx: AuthContext, method: string, path: string, label: string, body?: unknown): Promise<JsonRecord> {
  const response = await request<JsonRecord>({ method, path, extraHeaders: ctx.headers, body, expected: [200, 201, 202] });
  assert(typeof response.data === 'object' && response.data !== null, `${label} no devolvió JSON.`);
  return response.data;
}

async function main(): Promise<void> {
  logSmokeConfig();
  const ctx = await login();

  await expectOk(ctx, 'GET', '/internal/auth/me', 'perfil interno');

  const users = await expectNonEmptyGet(ctx, '/internal/users', 'usuarios internos');
  await expectOk(ctx, 'GET', `/internal/users/${firstId(users, ['id', 'internalUserId'], 'usuarios internos')}`, 'detalle usuario');

  const roles = await expectNonEmptyGet(ctx, '/internal/roles', 'roles internos');
  await expectOk(ctx, 'GET', `/internal/roles/${firstId(roles, ['id', 'roleId'], 'roles internos')}`, 'detalle rol');
  await expectNonEmptyGet(ctx, '/internal/permissions', 'permisos internos');

  const glossary = await expectNonEmptyGet(ctx, '/internal/business-metadata/glossary', 'glosario negocio');
  await expectOk(ctx, 'GET', `/internal/business-metadata/terms/${encodeURIComponent(firstId(glossary, ['termId'], 'glosario'))}`, 'detalle término');

  const exportsList = await expectNonEmptyGet(ctx, '/internal/exports', 'exports');
  await expectOk(ctx, 'GET', `/internal/exports/${firstId(exportsList, ['exportId'], 'exports')}`, 'detalle export');

  const rules = await expectNonEmptyGet(ctx, '/internal/data-quality/rules', 'reglas calidad');
  const ruleId = firstId(rules, ['ruleId', 'id'], 'reglas calidad');
  await expectOk(ctx, 'GET', `/internal/data-quality/rules/${ruleId}`, 'detalle regla calidad');
  await expectOk(ctx, 'POST', `/internal/data-quality/rules/${ruleId}/run`, 'ejecutar regla calidad');

  const governanceResponse = await expectOk(ctx, 'GET', '/operations/data-governance/policies', 'políticas gobierno');
  const governanceData = (governanceResponse.data ?? governanceResponse) as JsonRecord;
  const governanceFamilies = [
    ['purpose', getArrayFromPaths<JsonRecord>(governanceData, [['privacyPurposes']]), ['purposeId']],
    ['retention', getArrayFromPaths<JsonRecord>(governanceData, [['retentionPolicies']]), ['retentionPolicyId']],
    ['classification', getArrayFromPaths<JsonRecord>(governanceData, [['classificationPolicies']]), ['classificationPolicyId']],
    ['sensitive', getArrayFromPaths<JsonRecord>(governanceData, [['sensitiveFieldRules']]), ['sensitiveFieldRuleId']],
    ['quality', getArrayFromPaths<JsonRecord>(governanceData, [['dataQualityRules']]), ['dataQualityRuleId']],
  ] as const;
  const selectedGovernanceFamily = governanceFamilies.find(([, rows]) => rows.length > 0);
  assert(Boolean(selectedGovernanceFamily), 'políticas gobierno devolvió todas las familias vacías.');
  if (!selectedGovernanceFamily) throw new Error('políticas gobierno no tiene familia seleccionable.');
  const [policyKind, policyRows, policyKeys] = selectedGovernanceFamily;
  const policyId = `${policyKind}:${firstId(policyRows, [...policyKeys], 'políticas gobierno')}`;
  await expectOk(ctx, 'GET', `/internal/governance/policies/${encodeURIComponent(policyId)}`, 'detalle política gobierno');

  const lineage = await expectOk(ctx, 'GET', '/internal/lineage', 'linaje');
  const lineageItems = getArrayFromPaths<JsonRecord>(lineage, [['data', 'nodes'], ['nodes']]);
  assert(lineageItems.length > 0, 'linaje no devolvió nodos.');
  await expectOk(ctx, 'GET', `/internal/lineage/nodes/${firstId(lineageItems, ['nodeId', 'id'], 'linaje')}`, 'detalle nodo linaje');
  await expectOk(ctx, 'GET', '/internal/lineage/impact?nodeId=table:customers', 'impacto linaje');

  const alerts = await expectNonEmptyGet(ctx, '/internal/alerts', 'alertas');
  await expectOk(ctx, 'POST', `/internal/alerts/${encodeURIComponent(firstId(alerts, ['alertId'], 'alertas'))}/acknowledge`, 'ack alerta');

  const jobs = await expectNonEmptyGet(ctx, '/internal/jobs', 'jobs');
  const jobId = firstId(jobs, ['jobRunId', 'id'], 'jobs');
  await expectOk(ctx, 'GET', `/internal/jobs/${jobId}`, 'detalle job');
  await expectOk(ctx, 'POST', `/internal/jobs/${jobId}/retry`, 'retry job');
  await expectOk(ctx, 'POST', `/internal/jobs/${jobId}/cancel`, 'cancel job');

  await expectOk(ctx, 'GET', '/internal/release-readiness', 'release readiness');

  const reports = await expectNonEmptyGet(ctx, '/internal/reports', 'reportes');
  const reportId = firstId(reports, ['reportId'], 'reportes');
  await expectOk(ctx, 'GET', `/internal/reports/${reportId}`, 'detalle reporte');
  await expectOk(ctx, 'POST', `/internal/reports/${reportId}/run`, 'run reporte', { filters: {} });
  await expectNonEmptyGet(ctx, `/internal/reports/${reportId}/snapshots`, 'snapshots reporte');

  const endpoints = await expectNonEmptyGet(ctx, '/systems/endpoints', 'endpoints sistemas');
  const endpointId = firstId(endpoints, ['endpointId', 'id'], 'endpoints');
  await expectOk(ctx, 'GET', `/systems/endpoints/${endpointId}`, 'detalle endpoint');

  const entities = await expectNonEmptyGet(ctx, '/systems/data-entities', 'entidades datos');
  const entityId = firstId(entities, ['entityId', 'id'], 'entidades datos');
  await expectOk(ctx, 'GET', `/systems/data-entities/${entityId}`, 'detalle entidad datos');
  await expectOk(ctx, 'PATCH', `/systems/data-entities/${entityId}/metadata`, 'patch metadata entidad', { businessPurpose: 'Smoke frontend contract verified', reason: 'frontend-contract-smoke' });

  await expectNonEmptyGet(ctx, '/systems/action-logs', 'action logs');
  await expectOk(ctx, 'GET', '/systems/action-logs/request/seed-req-dashboard-101', 'action logs por request');
  await expectNonEmptyGet(ctx, '/systems/tools', 'tools sistemas');
  await expectNonEmptyGet(ctx, '/systems/test-suites', 'test suites');
  await expectNonEmptyGet(ctx, '/systems/review-queue', 'review queue');
  await expectNonEmptyGet(ctx, '/systems/stress-profiles', 'stress profiles');
  await expectNonEmptyGet(ctx, '/systems/stress-matrix', 'stress matrix');
  await expectOk(ctx, 'GET', '/internal/search?q=customer', 'búsqueda global');

  console.log('[OK] Frontend contract smoke completo: llamadas críticas del portal no devolvieron tablas vacías ni errores silenciosos.');
}

void main().catch((error) => {
  console.error('[FAIL] Frontend contract smoke falló');
  console.error(error);
  process.exitCode = 1;
});
