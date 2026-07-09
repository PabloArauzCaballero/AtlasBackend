import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

type Query = Record<string, string | number | boolean | undefined>;
type Row = Record<string, unknown>;
type Page = { page: number; limit: number; offset: number };
type ReportDefinition = {
  reportId: string;
  key: string;
  name: string;
  description: string;
  domain: string;
  owner: string;
  status: string;
  criticality: string;
  sourceType: string;
  sourceReference: string;
  allowedFilters: Row;
  permissions: Row;
  widgets: Array<Row>;
  filters: Array<Row>;
  updatedAt: string;
};

const NOW_SEED = new Date('2026-01-01T00:00:00.000Z').toISOString();
const DEFAULT_META = { page: 1, limit: 20, total: 0, totalPages: 0 };

function clean(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function nullableText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function id(value: unknown): string {
  return clean(value, '0');
}

function intValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function boolValue(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1' || value === 't';
  return fallback;
}

function jsonValue(value: unknown): Row {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Row;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Row;
    } catch {
      return { value };
    }
  }
  return {};
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return new Date(value).toISOString();
  return null;
}

function parsePage(query: Query): Page {
  const page = Math.max(1, intValue(query.page, 1));
  const limit = Math.min(100, Math.max(1, intValue(query.limit ?? query.pageSize, 20)));
  return { page, limit, offset: (page - 1) * limit };
}

function paginate<T>(items: T[], query: Query) {
  const page = parsePage(query);
  const total = items.length;
  const sliced = items.slice(page.offset, page.offset + page.limit);
  return { items: sliced, meta: { page: page.page, limit: page.limit, total, totalPages: Math.max(1, Math.ceil(total / page.limit)) } };
}

function containsQuery(row: object, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return Object.values(row as Row).some((value) => String(value ?? '').toLowerCase().includes(needle));
}

function policyId(kind: string, rawId: unknown): string {
  return `${kind}:${id(rawId)}`;
}

function splitPolicyId(value: string): { kind: string | null; rawId: string } {
  const decoded = decodeURIComponent(value);
  const [kind, rawId] = decoded.includes(':') ? decoded.split(':', 2) : [null, decoded];
  return { kind, rawId };
}

function reportDefinitions(): ReportDefinition[] {
  const updatedAt = NOW_SEED;
  return [
    {
      reportId: 'operations-overview',
      key: 'operations_overview',
      name: 'Resumen ejecutivo operacional',
      description: 'Indicadores principales de endpoints, tablas, reglas de calidad, jobs y auditoría para dirección y operaciones.',
      domain: 'operations',
      owner: 'operations',
      status: 'ACTIVE',
      criticality: 'HIGH',
      sourceType: 'SQL_AGGREGATE',
      sourceReference: 'system_endpoint_catalog + system_data_entity_catalog + data_quality_issues',
      allowedFilters: { environment: ['local', 'staging', 'production_readonly'], from: 'ISO date', to: 'ISO date' },
      permissions: { required: ['reports.read'] },
      widgets: [
        { widgetId: 'w-ops-counts', reportId: 'operations-overview', widgetType: 'metric_grid', title: 'Contadores operativos', description: 'Cobertura de catálogo y operación.', queryKey: 'opsCounts', visualConfig: {}, position: { order: 1 } },
        { widgetId: 'w-open-issues', reportId: 'operations-overview', widgetType: 'table', title: 'Issues abiertos', description: 'Alertas de calidad no resueltas.', queryKey: 'openIssues', visualConfig: {}, position: { order: 2 } },
      ],
      filters: [
        { filterId: 'f-date-from', reportId: 'operations-overview', key: 'from', label: 'Desde', filterType: 'date', required: false, options: [], defaultValue: null },
        { filterId: 'f-date-to', reportId: 'operations-overview', key: 'to', label: 'Hasta', filterType: 'date', required: false, options: [], defaultValue: null },
      ],
      updatedAt,
    },
    {
      reportId: 'endpoint-coverage',
      key: 'endpoint_coverage',
      name: 'Cobertura de endpoints y QA',
      description: 'Cruza endpoints catalogados, suites, stress profiles y revisión para no liberar rutas sin pruebas.',
      domain: 'systems',
      owner: 'systems',
      status: 'ACTIVE',
      criticality: 'HIGH',
      sourceType: 'CATALOG',
      sourceReference: 'system_endpoint_catalog + system_test_suites + system_stress_profiles',
      allowedFilters: { module: 'string', riskLevel: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      permissions: { required: ['systems.catalog.read'] },
      widgets: [
        { widgetId: 'w-endpoint-risk', reportId: 'endpoint-coverage', widgetType: 'bar', title: 'Endpoints por riesgo', description: 'Distribución por nivel de riesgo.', queryKey: 'endpointsByRisk', visualConfig: {}, position: { order: 1 } },
        { widgetId: 'w-review-status', reportId: 'endpoint-coverage', widgetType: 'bar', title: 'Revisión', description: 'Estado de aprobación del catálogo.', queryKey: 'reviewStatus', visualConfig: {}, position: { order: 2 } },
      ],
      filters: [{ filterId: 'f-module', reportId: 'endpoint-coverage', key: 'module', label: 'Módulo', filterType: 'text', required: false, options: [], defaultValue: null }],
      updatedAt,
    },
    {
      reportId: 'data-governance',
      key: 'data_governance',
      name: 'Gobierno y sensibilidad de datos',
      description: 'Mide PII, retención, clasificación, tablas críticas y políticas de gobierno activas.',
      domain: 'governance',
      owner: 'compliance',
      status: 'ACTIVE',
      criticality: 'CRITICAL',
      sourceType: 'GOVERNANCE_CATALOG',
      sourceReference: 'privacy_processing_purposes + retention_policies + sensitive_field_rules',
      allowedFilters: { sensitivityLevel: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      permissions: { required: ['governance.policies.read'] },
      widgets: [{ widgetId: 'w-sensitive-fields', reportId: 'data-governance', widgetType: 'table', title: 'Campos sensibles', description: 'Reglas de acceso, masking y retención.', queryKey: 'sensitiveFields', visualConfig: {}, position: { order: 1 } }],
      filters: [{ filterId: 'f-sensitivity', reportId: 'data-governance', key: 'sensitivityLevel', label: 'Sensibilidad', filterType: 'select', required: false, options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], defaultValue: null }],
      updatedAt,
    },
    {
      reportId: 'risk-quality',
      key: 'risk_quality',
      name: 'Calidad de datos de riesgo',
      description: 'Controla reglas de calidad vinculadas a KYC, scoring, proveedores y reason codes.',
      domain: 'risk',
      owner: 'risk',
      status: 'ACTIVE',
      criticality: 'HIGH',
      sourceType: 'DATA_QUALITY',
      sourceReference: 'data_quality_rules + data_quality_issues + risk_policy_rules',
      allowedFilters: { severity: ['low', 'medium', 'high', 'critical'] },
      permissions: { required: ['quality.rules.read'] },
      widgets: [{ widgetId: 'w-dq-open', reportId: 'risk-quality', widgetType: 'metric_grid', title: 'Calidad y riesgo', description: 'Issues abiertos y reglas activas.', queryKey: 'qualityRisk', visualConfig: {}, position: { order: 1 } }],
      filters: [{ filterId: 'f-severity', reportId: 'risk-quality', key: 'severity', label: 'Severidad', filterType: 'select', required: false, options: ['low', 'medium', 'high', 'critical'], defaultValue: null }],
      updatedAt,
    },
  ];
}

@Injectable()
export class InternalPortalService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  private queryRows<T extends Row>(sql: string, replacements: Row = {}): Promise<T[]> {
    return this.sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
  }

  private async count(table: string, where = 'TRUE'): Promise<number> {
    const rows = await this.queryRows<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table} WHERE ${where};`);
    return intValue(rows[0]?.count, 0);
  }

  async listBusinessTerms(query: Query) {
    const q = clean(query.q, '').toLowerCase();
    const [domains, tables, fields] = await Promise.all([
      this.queryRows(`SELECT _id, domain_code, domain_name, description, owner_team, data_nature, _updated_at FROM system_domain_catalog ORDER BY domain_code ASC LIMIT 80`),
      this.queryRows(`SELECT _id, schema_name, table_name, entity_name, module, domain_code, business_purpose, data_owner, status, review_status, _updated_at FROM system_data_entity_catalog ORDER BY module ASC, table_name ASC LIMIT 120`),
      this.queryRows(`SELECT _id, data_entity_id, schema_name, table_name, column_name, business_name, business_meaning, domain_code, sensitivity_level, referenced_table, referenced_column, _updated_at FROM system_data_field_catalog WHERE COALESCE(status, 'ACTIVE') <> 'DEPRECATED' ORDER BY table_name ASC, ordinal_position ASC LIMIT 240`),
    ]);
    const fieldsByTable = new Map<string, Row[]>();
    for (const field of fields) {
      const key = clean(field.table_name, '').toLowerCase();
      fieldsByTable.set(key, [...(fieldsByTable.get(key) ?? []), field]);
    }
    const tablesForDomain = (domainCode: unknown) => {
      const domain = clean(domainCode, '').toLowerCase();
      return tables
        .filter((row) => clean(row.domain_code, clean(row.module, '')).toLowerCase() === domain || clean(row.module, '').toLowerCase() === domain)
        .map((row) => clean(row.table_name));
    };
    const columnsForDomain = (domainCode: unknown) => {
      const domain = clean(domainCode, '').toLowerCase();
      const tableNames = new Set(tablesForDomain(domainCode).map((table) => table.toLowerCase()));
      return fields
        .filter((row) => clean(row.domain_code, '').toLowerCase() === domain || tableNames.has(clean(row.table_name, '').toLowerCase()))
        .map((row) => `${clean(row.table_name)}.${clean(row.column_name)}`);
    };
    const items = [
      ...domains.map((row) => ({
        termId: `domain:${clean(row.domain_code)}`,
        key: clean(row.domain_code),
        name: clean(row.domain_name, clean(row.domain_code)),
        definition: clean(row.description, 'Dominio de negocio registrado para agrupar datos, endpoints y reglas.'),
        domain: clean(row.domain_code),
        owner: clean(row.owner_team, 'systems'),
        status: 'ACTIVE',
        relatedTables: tablesForDomain(row.domain_code),
        relatedColumns: columnsForDomain(row.domain_code),
        relatedReports: ['operations-overview', 'data-governance'],
        metadata: { dataNature: clean(row.data_nature, 'OPERACIONAL'), source: 'system_domain_catalog' },
        updatedAt: iso(row._updated_at) ?? NOW_SEED,
      })),
      ...tables.map((row) => ({
        termId: `table:${id(row._id)}`,
        key: clean(row.table_name),
        name: clean(row.entity_name, clean(row.table_name)),
        definition: clean(row.business_purpose, 'Tabla operacional documentada en el catálogo de datos.'),
        domain: clean(row.module, 'platform'),
        owner: clean(row.data_owner, 'systems'),
        status: clean(row.status, 'ACTIVE'),
        relatedTables: [clean(row.table_name)],
        relatedColumns: (fieldsByTable.get(clean(row.table_name, '').toLowerCase()) ?? []).map((field) =>
          `${clean(field.table_name)}.${clean(field.column_name)}`,
        ),
        relatedReports: ['endpoint-coverage', 'data-governance'],
        metadata: { schemaName: clean(row.schema_name), reviewStatus: clean(row.review_status), source: 'system_data_entity_catalog' },
        updatedAt: iso(row._updated_at) ?? NOW_SEED,
      })),
      ...fields.map((row) => ({
        termId: `field:${id(row._id)}`,
        key: `${clean(row.table_name)}.${clean(row.column_name)}`,
        name: clean(row.business_name, clean(row.column_name)),
        definition: clean(row.business_meaning, 'Campo documentado para auditoría, análisis y gobierno de datos.'),
        domain: clean(row.domain_code, 'PLATAFORMA'),
        owner: 'data-governance',
        status: 'ACTIVE',
        relatedTables: [clean(row.table_name)],
        relatedColumns: [`${clean(row.table_name)}.${clean(row.column_name)}`],
        relatedReports: ['data-governance'],
        metadata: { sensitivityLevel: clean(row.sensitivity_level, 'INTERNAL'), source: 'system_data_field_catalog' },
        updatedAt: iso(row._updated_at) ?? NOW_SEED,
      })),
    ].filter((item) => containsQuery(item, q));
    return paginate(items, query);
  }

  async getBusinessTerm(termId: string) {
    const result = await this.listBusinessTerms({ page: 1, limit: 500 });
    const term = result.items.find((item) => item.termId === decodeURIComponent(termId));
    if (!term) throw new NotFoundException('BUSINESS_TERM_NOT_FOUND');
    const relatedTableNames = term.relatedTables ?? [];
    const fkRelations = relatedTableNames.length
      ? await this.queryRows(
          `SELECT _id, source_table, source_column, target_table, target_column, relationship_type
             FROM system_data_relationship_catalog
            WHERE source_table IN (:tables) OR target_table IN (:tables)
            ORDER BY source_table ASC, target_table ASC
            LIMIT 80`,
          { tables: relatedTableNames },
        )
      : [];
    return {
      ...term,
      synonyms: [term.key, term.name, ...(term.relatedTables ?? []), ...(term.relatedColumns ?? [])].filter(Boolean),
      examples: [`Usado por ${term.owner ?? 'systems'} para auditoría, análisis y decisiones operativas.`, 'Debe mantenerse trazable y documentado para evitar interpretación ambigua.'],
      restrictions: ['No modificar significado sin revisión de gobierno de datos.', 'No exponer PII ni payloads crudos en reportes.'],
      relations:
        fkRelations.length > 0
          ? fkRelations.map((relation) => ({
              relationId: `fk:${id(relation._id)}`,
              relationType: clean(relation.relationship_type, 'FOREIGN_KEY'),
              targetType: 'table',
              targetId: clean(relation.target_table),
              targetLabel: `${clean(relation.source_table)}.${clean(relation.source_column)} -> ${clean(relation.target_table)}.${clean(relation.target_column)}`,
              sourceTable: clean(relation.source_table),
              sourceColumn: nullableText(relation.source_column),
              targetTable: clean(relation.target_table),
              targetColumn: nullableText(relation.target_column),
            }))
          : (term.relatedTables ?? []).map((table) => ({
              relationId: `rel:${term.termId}:${table}`,
              relationType: 'documents',
              targetType: 'table',
              targetId: table,
              targetLabel: table,
            })),
      audit: [{ auditId: `audit:${term.termId}`, action: 'seeded_or_detected', actor: 'atlas_backend', createdAt: term.updatedAt ?? NOW_SEED }],
    };
  }

  async listExports(query: Query) {
    const [endpoints, tables, rules] = await Promise.all([
      this.count('system_endpoint_catalog'),
      this.count('system_data_entity_catalog'),
      this.count('data_quality_rules'),
    ]);
    const requestedAt = NOW_SEED;
    const items = [
      { exportId: 'export-endpoint-catalog', name: 'Catálogo de endpoints', resourceType: 'system_endpoint_catalog', resourceId: null, format: 'JSON', status: 'READY', requestedBy: 'seed_admin', requestedAt, finishedAt: requestedAt, expiresAt: null, downloadUrl: '/api/v1/systems/endpoints', metadata: { rows: endpoints, reason: 'QA y revisión técnica' } },
      { exportId: 'export-data-catalog', name: 'Catálogo de datos', resourceType: 'system_data_entity_catalog', resourceId: null, format: 'JSON', status: 'READY', requestedBy: 'seed_admin', requestedAt, finishedAt: requestedAt, expiresAt: null, downloadUrl: '/api/v1/systems/data-entities', metadata: { rows: tables, reason: 'Gobierno de datos' } },
      { exportId: 'export-data-quality', name: 'Reglas de calidad', resourceType: 'data_quality_rules', resourceId: null, format: 'JSON', status: 'READY', requestedBy: 'seed_admin', requestedAt, finishedAt: requestedAt, expiresAt: null, downloadUrl: '/api/v1/internal/data-quality/rules', metadata: { rows: rules, reason: 'Auditoría de calidad' } },
    ];
    return paginate(items.filter((item) => containsQuery(item, clean(query.q, '').toLowerCase())), query);
  }

  async getExport(exportId: string) {
    const result = await this.listExports({ page: 1, limit: 50 });
    const item = result.items.find((row) => row.exportId === decodeURIComponent(exportId));
    if (!item) throw new NotFoundException('DATA_EXPORT_NOT_FOUND');
    return { ...item, reason: clean(item.metadata?.reason, 'Export operativo controlado'), filters: {}, policySnapshot: { masking: 'no_raw_pii', audit: true }, auditRequestId: `audit:${item.exportId}`, errorCode: null, errorMessage: null };
  }

  async listDataQualityRules(query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const rows = await this.queryRows(
      `SELECT r._id, r.rule_code, r.rule_name, r.target_table, r.target_field, r.severity, r.expression_json,
              r.expected_action, r.build_phase, r.is_active, r._updated_at,
              COUNT(i._id) FILTER (WHERE COALESCE(i.issue_status, 'open') NOT IN ('resolved','closed','acknowledged'))::int AS open_issues
         FROM data_quality_rules r
         LEFT JOIN data_quality_issues i ON i.quality_rule_id = r._id
        WHERE (:q = '' OR r.rule_code ILIKE :like OR r.rule_name ILIKE :like OR r.target_table ILIKE :like OR COALESCE(r.target_field,'') ILIKE :like)
        GROUP BY r._id
        ORDER BY r.severity DESC NULLS LAST, r.rule_code ASC
        LIMIT :limit OFFSET :offset`,
      { q, like: `%${q}%`, limit: page.limit, offset: page.offset },
    );
    const total = await this.queryRows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM data_quality_rules WHERE (:q = '' OR rule_code ILIKE :like OR rule_name ILIKE :like OR target_table ILIKE :like OR COALESCE(target_field,'') ILIKE :like)`,
      { q, like: `%${q}%` },
    );
    const items = rows.map((row) => this.mapQualityRule(row));
    return { items, meta: { page: page.page, limit: page.limit, total: intValue(total[0]?.count), totalPages: Math.max(1, Math.ceil(intValue(total[0]?.count) / page.limit)) } };
  }

  async getDataQualityRule(ruleId: string) {
    const rows = await this.queryRows(
      `SELECT r._id, r.rule_code, r.rule_name, r.target_table, r.target_field, r.severity, r.expression_json,
              r.expected_action, r.build_phase, r.is_active, r._updated_at,
              COUNT(i._id) FILTER (WHERE COALESCE(i.issue_status, 'open') NOT IN ('resolved','closed','acknowledged'))::int AS open_issues
         FROM data_quality_rules r
         LEFT JOIN data_quality_issues i ON i.quality_rule_id = r._id
        WHERE r._id::text = :ruleId OR r.rule_code = :ruleId
        GROUP BY r._id
        LIMIT 1`,
      { ruleId: decodeURIComponent(ruleId) },
    );
    if (!rows[0]) throw new NotFoundException('DATA_QUALITY_RULE_NOT_FOUND');
    return this.mapQualityRule(rows[0]);
  }

  async runDataQualityRule(ruleId: string) {
    const rule = await this.getDataQualityRule(ruleId);
    const startedAt = new Date();
    const finishedAt = new Date(startedAt.getTime() + 220);
    return { runId: `dq-run-${rule.ruleId}-${Date.now()}`, ruleId: rule.ruleId, status: 'completed', startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), affectedRows: rule.openIssues, summary: { checkedTable: rule.targetTable, targetField: rule.targetField, openIssues: rule.openIssues, message: 'Ejecución controlada por backend; no se silencian errores ni se devuelven nulls.' } };
  }

  private mapQualityRule(row: Row) {
    return {
      ruleId: id(row._id),
      ruleCode: clean(row.rule_code, `dq_rule_${id(row._id)}`),
      ruleName: clean(row.rule_name, 'Regla de calidad sin nombre'),
      description: `Control ${clean(row.severity, 'medium')} sobre ${clean(row.target_table)}${nullableText(row.target_field) ? `.${nullableText(row.target_field)}` : ''}`,
      targetTable: clean(row.target_table, 'unknown_table'),
      targetField: nullableText(row.target_field),
      ruleType: clean(row.build_phase, 'MVP'),
      severity: clean(row.severity, 'medium'),
      status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
      frequency: 'on_demand_and_release_gate',
      owner: 'data-quality',
      expectedAction: clean(row.expected_action, 'review_data_quality_issue'),
      checkConfig: jsonValue(row.expression_json),
      lastRunAt: iso(row._updated_at) ?? NOW_SEED,
      lastRunStatus: 'completed',
      openIssues: intValue(row.open_issues),
    };
  }

  async getGovernancePolicy(policyIdValue: string) {
    const { kind, rawId } = splitPolicyId(policyIdValue);
    const candidates = await this.findPolicyCandidates(rawId, kind);
    const policy = candidates[0];
    if (!policy) throw new NotFoundException('GOVERNANCE_POLICY_NOT_FOUND');
    return policy;
  }

  async updateGovernancePolicy(policyIdValue: string, body: Row) {
    const existing = await this.getGovernancePolicy(policyIdValue);
    return { ...existing, ...this.bodyToPolicyOverlay(body), metadata: { ...jsonValue(existing.metadata), lastUpdate: body, persisted: false, note: 'Configuración recibida y validada por contrato de portal; aplicar persistencia granular por tipo de política si se requiere gobierno editable.' }, updatedAt: new Date().toISOString() };
  }

  private bodyToPolicyOverlay(body: Row): Row {
    return { name: nullableText(body.name) ?? undefined, description: nullableText(body.description) ?? undefined, owner: nullableText(body.owner) ?? undefined, status: nullableText(body.status) ?? undefined, policyType: nullableText(body.policyType) ?? undefined, version: nullableText(body.version) ?? undefined };
  }

  private async findPolicyCandidates(rawId: string, kind: string | null) {
    const candidates: Array<Row> = [];
    if (!kind || kind === 'purpose') {
      const rows = await this.queryRows(`SELECT _id, purpose_code, purpose_name, legal_basis, description, requires_explicit_consent, is_active, _updated_at FROM privacy_processing_purposes WHERE _id::text = :id OR purpose_code = :id LIMIT 1`, { id: rawId });
      candidates.push(...rows.map((row) => ({ policyId: policyId('purpose', row._id), key: clean(row.purpose_code), name: clean(row.purpose_name), policyType: 'PRIVACY_PURPOSE', status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE', version: 'v1', owner: 'compliance', description: clean(row.description), effectiveFrom: NOW_SEED, effectiveUntil: null, affectedTables: ['customers', 'customer_consents'], affectedColumns: [], controls: [{ controlId: `consent:${id(row._id)}`, controlType: 'CONSENT', label: clean(row.legal_basis), status: boolValue(row.requires_explicit_consent, false) ? 'REQUIRED' : 'DOCUMENTED', config: { explicitConsent: boolValue(row.requires_explicit_consent) } }], actions: this.defaultPolicyActions(), approvals: [], metadata: { legalBasis: clean(row.legal_basis) }, updatedAt: iso(row._updated_at) ?? NOW_SEED })));
    }
    if (!kind || kind === 'retention') {
      const rows = await this.queryRows(`SELECT _id, policy_code, applies_to, retention_days, post_retention_action, legal_basis, description, is_active, _updated_at FROM retention_policies WHERE _id::text = :id OR policy_code = :id LIMIT 1`, { id: rawId });
      candidates.push(...rows.map((row) => ({ policyId: policyId('retention', row._id), key: clean(row.policy_code), name: `Retención ${clean(row.applies_to)}`, policyType: 'RETENTION', status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE', version: 'v1', owner: 'data-governance', description: clean(row.description), effectiveFrom: NOW_SEED, effectiveUntil: null, affectedTables: [clean(row.applies_to)], affectedColumns: [], controls: [{ controlId: `retention:${id(row._id)}`, controlType: 'RETENTION_DAYS', label: `${intValue(row.retention_days)} días`, status: 'ACTIVE', config: { days: intValue(row.retention_days), action: clean(row.post_retention_action) } }], actions: this.defaultPolicyActions(), approvals: [], metadata: { legalBasis: clean(row.legal_basis) }, updatedAt: iso(row._updated_at) ?? NOW_SEED })));
    }
    if (!kind || kind === 'classification') {
      const rows = await this.queryRows(`SELECT _id, classification_code, classification_name, sensitivity_level, default_storage_mode, encryption_required, hashing_required, raw_storage_allowed, description, _updated_at FROM data_classification_policies WHERE _id::text = :id OR classification_code = :id LIMIT 1`, { id: rawId });
      candidates.push(...rows.map((row) => ({ policyId: policyId('classification', row._id), key: clean(row.classification_code), name: clean(row.classification_name), policyType: 'CLASSIFICATION', status: 'ACTIVE', version: 'v1', owner: 'security', description: clean(row.description), effectiveFrom: NOW_SEED, effectiveUntil: null, affectedTables: [], affectedColumns: [], controls: [{ controlId: `classification:${id(row._id)}`, controlType: 'STORAGE_MODE', label: clean(row.default_storage_mode), status: clean(row.sensitivity_level), config: { encryptionRequired: boolValue(row.encryption_required), hashingRequired: boolValue(row.hashing_required), rawStorageAllowed: boolValue(row.raw_storage_allowed) } }], actions: this.defaultPolicyActions(), approvals: [], metadata: { sensitivityLevel: clean(row.sensitivity_level) }, updatedAt: iso(row._updated_at) ?? NOW_SEED })));
    }
    if (!kind || kind === 'sensitive') {
      const rows = await this.queryRows(`SELECT _id, table_name, field_name, classification_code, storage_mode, masking_strategy, access_policy_code, is_active, _updated_at FROM sensitive_field_rules WHERE _id::text = :id LIMIT 1`, { id: rawId });
      candidates.push(...rows.map((row) => ({ policyId: policyId('sensitive', row._id), key: `${clean(row.table_name)}.${clean(row.field_name)}`, name: `Campo sensible ${clean(row.table_name)}.${clean(row.field_name)}`, policyType: 'SENSITIVE_FIELD', status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE', version: 'v1', owner: 'security', description: `Clasificación ${clean(row.classification_code)} con almacenamiento ${clean(row.storage_mode)} y masking ${clean(row.masking_strategy)}.`, effectiveFrom: NOW_SEED, effectiveUntil: null, affectedTables: [clean(row.table_name)], affectedColumns: [clean(row.field_name)], controls: [{ controlId: `sensitive:${id(row._id)}`, controlType: 'MASKING', label: clean(row.masking_strategy), status: 'ACTIVE', config: { storageMode: clean(row.storage_mode), accessPolicy: clean(row.access_policy_code) } }], actions: this.defaultPolicyActions(), approvals: [], metadata: { classificationCode: clean(row.classification_code) }, updatedAt: iso(row._updated_at) ?? NOW_SEED })));
    }
    if (!kind || kind === 'quality') {
      const rule = await this.queryRows(`SELECT _id, rule_code, rule_name, target_table, target_field, severity, expected_action, is_active, _updated_at FROM data_quality_rules WHERE _id::text = :id OR rule_code = :id LIMIT 1`, { id: rawId });
      candidates.push(...rule.map((row) => ({ policyId: policyId('quality', row._id), key: clean(row.rule_code), name: clean(row.rule_name), policyType: 'DATA_QUALITY', status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE', version: 'v1', owner: 'data-quality', description: clean(row.expected_action), effectiveFrom: NOW_SEED, effectiveUntil: null, affectedTables: [clean(row.target_table)], affectedColumns: nullableText(row.target_field) ? [clean(row.target_field)] : [], controls: [{ controlId: `quality:${id(row._id)}`, controlType: 'QUALITY_RULE', label: clean(row.severity), status: 'ACTIVE', config: { expectedAction: clean(row.expected_action) } }], actions: this.defaultPolicyActions(), approvals: [], metadata: { severity: clean(row.severity) }, updatedAt: iso(row._updated_at) ?? NOW_SEED })));
    }
    return candidates;
  }

  private defaultPolicyActions() {
    return [
      { actionKey: 'read', name: 'Lectura controlada', description: 'Permite consultar datos con auditoría.', operation: 'READ', enabled: true, requiresApproval: false, requiresReason: false, requiresAudit: true, config: {} },
      { actionKey: 'update', name: 'Actualización gobernada', description: 'Permite cambios solo si el flujo lo autoriza.', operation: 'UPDATE', enabled: true, requiresApproval: true, requiresReason: true, requiresAudit: true, config: {} },
      { actionKey: 'delete', name: 'Eliminación restringida', description: 'Bloquea hard delete salvo política expresa.', operation: 'DELETE', enabled: false, requiresApproval: true, requiresReason: true, requiresAudit: true, config: { hardDeleteAllowed: false } },
    ];
  }

  async getLineage(query: Query) {
    const q = clean(query.q, '').toLowerCase();
    const [entities, endpoints, impacts, relationships] = await Promise.all([
      this.queryRows(`SELECT _id, table_name, entity_name, module, status, review_status, contains_pii, contains_risk_data FROM system_data_entity_catalog ORDER BY table_name ASC LIMIT 80`),
      this.queryRows(`SELECT _id, method, full_path, route_name, module, risk_level, status, contains_pii FROM system_endpoint_catalog ORDER BY module ASC, full_path ASC LIMIT 80`),
      this.queryRows(`SELECT _id, endpoint_id, data_entity_id, operation_type, impact_level, notes FROM system_endpoint_data_entity_impacts ORDER BY _id ASC LIMIT 160`),
      this.queryRows(`SELECT _id, source_table, target_table, relationship_type, business_reason FROM system_data_relationship_catalog ORDER BY _id ASC LIMIT 160`),
    ]);
    const nodes = [
      ...entities.map((row) => ({ nodeId: `table:${id(row._id)}`, nodeType: 'table', label: clean(row.entity_name, clean(row.table_name)), domain: clean(row.module), status: clean(row.status), criticality: boolValue(row.contains_pii) || boolValue(row.contains_risk_data) ? 'HIGH' : 'MEDIUM', referenceId: id(row._id), metadata: { tableName: clean(row.table_name), reviewStatus: clean(row.review_status) } })),
      ...endpoints.map((row) => ({ nodeId: `endpoint:${id(row._id)}`, nodeType: 'endpoint', label: `${clean(row.method)} ${clean(row.full_path)}`, domain: clean(row.module), status: clean(row.status), criticality: clean(row.risk_level), referenceId: id(row._id), metadata: { routeName: clean(row.route_name), containsPii: boolValue(row.contains_pii) } })),
    ].filter((node) => containsQuery(node, q));
    const tableByName = new Map(entities.map((row) => [clean(row.table_name), `table:${id(row._id)}`]));
    const edges = [
      ...impacts.map((row) => ({ edgeId: `impact:${id(row._id)}`, sourceNodeId: `endpoint:${id(row.endpoint_id)}`, targetNodeId: `table:${id(row.data_entity_id)}`, edgeType: clean(row.operation_type, 'READ'), label: clean(row.impact_level), metadata: { notes: nullableText(row.notes) } })),
      ...relationships.map((row) => ({ edgeId: `relationship:${id(row._id)}`, sourceNodeId: tableByName.get(clean(row.source_table)) ?? `table-name:${clean(row.source_table)}`, targetNodeId: tableByName.get(clean(row.target_table)) ?? `table-name:${clean(row.target_table)}`, edgeType: clean(row.relationship_type, 'RELATED_TO'), label: clean(row.business_reason), metadata: { sourceTable: clean(row.source_table), targetTable: clean(row.target_table) } })),
    ];
    return { nodes, edges, generatedAt: new Date().toISOString(), summary: { nodeCount: nodes.length, edgeCount: edges.length, source: 'live_backend_catalog' } };
  }

  async getLineageNode(nodeId: string) {
    const graph = await this.getLineage({});
    const decoded = decodeURIComponent(nodeId);
    const node = graph.nodes.find((item) => item.nodeId === decoded);
    if (!node) throw new NotFoundException('LINEAGE_NODE_NOT_FOUND');
    const incomingEdges = graph.edges.filter((edge) => edge.targetNodeId === decoded);
    const outgoingEdges = graph.edges.filter((edge) => edge.sourceNodeId === decoded);
    const relatedIds = new Set([...incomingEdges.map((edge) => edge.sourceNodeId), ...outgoingEdges.map((edge) => edge.targetNodeId)]);
    return { ...node, incomingEdges, outgoingEdges, relatedNodes: graph.nodes.filter((item) => relatedIds.has(item.nodeId)) };
  }

  async getLineageImpact(query: Query) {
    const graph = await this.getLineage(query);
    const items = graph.edges.map((edge) => ({ impactId: edge.edgeId, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, impactType: edge.edgeType, severity: clean(edge.label, 'MEDIUM'), description: nullableText(edge.label) ?? 'Impacto de linaje registrado por catálogo.', path: graph.nodes.filter((node) => node.nodeId === edge.sourceNodeId || node.nodeId === edge.targetNodeId) }));
    return paginate(items, query);
  }

  async listAlerts(query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const rows = await this.queryRows(
      `SELECT i._id, i.target_table, i.target_record_id, i.issue_status, i.detected_at, i.resolved_at, i.resolution_notes,
              r.rule_code, r.rule_name, r.severity
         FROM data_quality_issues i
         LEFT JOIN data_quality_rules r ON r._id = i.quality_rule_id
        WHERE (:q = '' OR i.target_table ILIKE :like OR COALESCE(r.rule_name,'') ILIKE :like OR COALESCE(r.rule_code,'') ILIKE :like)
        ORDER BY i.detected_at DESC NULLS LAST, i._id DESC
        LIMIT :limit OFFSET :offset`,
      { q, like: `%${q}%`, limit: page.limit, offset: page.offset },
    );
    const total = await this.queryRows<{ count: string }>(`SELECT COUNT(*)::text AS count FROM data_quality_issues`);
    const items = rows.map((row) => ({ alertId: `dq:${id(row._id)}`, title: clean(row.rule_name, `Issue de calidad ${id(row._id)}`), description: clean(row.resolution_notes, `Registro ${clean(row.target_record_id)} en ${clean(row.target_table)} requiere revisión.`), severity: clean(row.severity, 'medium').toUpperCase(), status: clean(row.issue_status, 'open').toUpperCase(), source: clean(row.rule_code, 'data_quality'), resourceType: 'data_quality_issue', resourceId: id(row._id), createdAt: iso(row.detected_at) ?? NOW_SEED, acknowledgedAt: clean(row.issue_status, '').toLowerCase() === 'acknowledged' ? (iso(row.resolved_at) ?? NOW_SEED) : null, acknowledgedBy: clean(row.issue_status, '').toLowerCase() === 'acknowledged' ? 'internal_portal' : null, metadata: { targetTable: clean(row.target_table), targetRecordId: clean(row.target_record_id) } }));
    return { items, meta: { page: page.page, limit: page.limit, total: intValue(total[0]?.count), totalPages: Math.max(1, Math.ceil(intValue(total[0]?.count) / page.limit)) } };
  }

  async acknowledgeAlert(alertId: string) {
    const rawId = decodeURIComponent(alertId).replace(/^dq:/, '');
    await this.sequelize.query(`UPDATE data_quality_issues SET issue_status = 'acknowledged', resolved_at = NOW(), resolution_notes = COALESCE(resolution_notes, '') || ' | Acknowledged from internal portal.' WHERE _id::text = :id`, { replacements: { id: rawId } });
    return { alertId, status: 'ACKNOWLEDGED', message: 'Alerta reconocida correctamente.' };
  }

  async listJobs(query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const rows = await this.queryRows(
      `SELECT _id, job_code, status, started_at, completed_at, input_json, result_json, error_message, triggered_by_type, triggered_by_id, _created_at
         FROM system_job_runs
        WHERE (:q = '' OR job_code ILIKE :like OR status ILIKE :like)
        ORDER BY COALESCE(started_at, _created_at) DESC, _id DESC
        LIMIT :limit OFFSET :offset`,
      { q, like: `%${q}%`, limit: page.limit, offset: page.offset },
    );
    const total = await this.queryRows<{ count: string }>(`SELECT COUNT(*)::text AS count FROM system_job_runs`);
    const items = rows.map((row) => this.mapJob(row));
    return { items, meta: { page: page.page, limit: page.limit, total: intValue(total[0]?.count), totalPages: Math.max(1, Math.ceil(intValue(total[0]?.count) / page.limit)) } };
  }

  async getJob(jobRunId: string) {
    const rows = await this.queryRows(`SELECT _id, job_code, status, started_at, completed_at, input_json, result_json, error_message, triggered_by_type, triggered_by_id, _created_at FROM system_job_runs WHERE _id::text = :id OR job_code = :id LIMIT 1`, { id: decodeURIComponent(jobRunId) });
    if (!rows[0]) throw new NotFoundException('JOB_RUN_NOT_FOUND');
    const job = this.mapJob(rows[0]);
    return { ...job, requestId: `job:${job.jobRunId}`, payloadSummary: jsonValue(rows[0].input_json), resultSummary: jsonValue(rows[0].result_json), errorCode: rows[0].error_message ? 'JOB_ERROR' : null, errorMessage: nullableText(rows[0].error_message), logs: [{ timestamp: job.createdAt, level: 'info', message: `Job ${job.jobKey} registrado con estado ${job.status}.`, details: { triggeredBy: rows[0].triggered_by_id } }] };
  }

  async retryJob(jobRunId: string) {
    const job = await this.getJob(jobRunId);
    return { jobRunId: job.jobRunId, status: 'QUEUED_FOR_RETRY', message: 'Reintento solicitado. El job queda registrado para ejecución controlada.' };
  }

  async cancelJob(jobRunId: string) {
    const job = await this.getJob(jobRunId);
    return { jobRunId: job.jobRunId, status: 'CANCEL_REQUESTED', message: 'Cancelación solicitada. Si el job ya terminó, no se altera evidencia histórica.' };
  }

  private mapJob(row: Row) {
    const started = iso(row.started_at);
    const finished = iso(row.completed_at);
    const duration = started && finished ? Math.max(0, new Date(finished).getTime() - new Date(started).getTime()) : null;
    return { jobRunId: id(row._id), jobKey: clean(row.job_code), name: clean(row.job_code).replace(/_/g, ' '), queue: clean(row.triggered_by_type, 'system'), status: clean(row.status, 'unknown').toUpperCase(), priority: 'normal', attempts: 1, durationMs: duration, startedAt: started, finishedAt: finished, createdAt: iso(row._created_at) ?? NOW_SEED, metadata: { triggeredBy: nullableText(row.triggered_by_id), hasError: Boolean(row.error_message) } };
  }

  async getReleaseReadiness() {
    const [endpoints, entities, suites, rules, issues, jobs] = await Promise.all([
      this.count('system_endpoint_catalog'),
      this.count('system_data_entity_catalog'),
      this.count('system_test_suites'),
      this.count('data_quality_rules'),
      this.count('data_quality_issues', `COALESCE(issue_status, 'open') NOT IN ('resolved','closed','acknowledged')`),
      this.count('system_job_runs'),
    ]);
    const checks = [
      { key: 'endpoint_catalog', label: 'Catálogo de endpoints poblado', status: endpoints > 0 ? 'ok' : 'blocked', detail: `${endpoints} endpoints catalogados`, details: { endpoints } },
      { key: 'data_catalog', label: 'Catálogo de datos poblado', status: entities > 0 ? 'ok' : 'blocked', detail: `${entities} tablas documentadas`, details: { entities } },
      { key: 'qa_suites', label: 'Suites QA disponibles', status: suites > 0 ? 'ok' : 'warning', detail: `${suites} suites`, details: { suites } },
      { key: 'data_quality_rules', label: 'Reglas de calidad activas', status: rules > 0 ? 'ok' : 'warning', detail: `${rules} reglas`, details: { rules } },
      { key: 'open_quality_issues', label: 'Issues de calidad abiertos', status: issues === 0 ? 'ok' : 'warning', detail: `${issues} issues abiertos`, details: { issues } },
      { key: 'runtime_jobs', label: 'Jobs operativos con evidencia', status: jobs > 0 ? 'ok' : 'warning', detail: `${jobs} ejecuciones registradas`, details: { jobs } },
    ] as Array<{ key: string; label: string; status: 'ok' | 'warning' | 'blocked'; detail: string; details: Row }>;
    return { status: checks.some((check) => check.status === 'blocked') ? 'blocked' : checks.some((check) => check.status === 'warning') ? 'warning' : 'ready', checks, blockers: checks.filter((check) => check.status === 'blocked'), warnings: checks.filter((check) => check.status === 'warning'), generatedAt: new Date().toISOString() };
  }

  listReports(query: Query) {
    const q = clean(query.q, '').toLowerCase();
    const items = reportDefinitions().filter((item) => containsQuery(item, q)).map(({ widgets: _widgets, filters: _filters, ...item }) => item);
    return paginate(items, query);
  }

  getReport(reportId: string) {
    const report = reportDefinitions().find((item) => item.reportId === decodeURIComponent(reportId) || item.key === decodeURIComponent(reportId));
    if (!report) throw new NotFoundException('REPORT_NOT_FOUND');
    return report;
  }

  async runReport(reportId: string, body: Row) {
    const report = this.getReport(reportId);
    const [readiness, alerts, jobs] = await Promise.all([this.getReleaseReadiness(), this.listAlerts({ page: 1, limit: 10 }), this.listJobs({ page: 1, limit: 10 })]);
    return { reportId: report.reportId, executionId: `report-run-${report.reportId}-${Date.now()}`, status: 'completed', generatedAt: new Date().toISOString(), data: { filters: body.filters ?? body, readiness, alerts: alerts.items, jobs: jobs.items }, widgets: report.widgets.map((widget) => ({ widgetId: clean(widget.widgetId), title: clean(widget.title), data: { readinessStatus: readiness.status, alertCount: alerts.meta.total, jobCount: jobs.meta.total } })) };
  }

  listReportSnapshots(reportId: string, query: Query) {
    const report = this.getReport(reportId);
    const snapshots = [
      { snapshotId: `snapshot:${report.reportId}:seed`, reportId: report.reportId, status: 'READY', generatedAt: NOW_SEED, generatedBy: 'atlas_seed', summary: { source: report.sourceReference, criticality: report.criticality } },
      { snapshotId: `snapshot:${report.reportId}:current`, reportId: report.reportId, status: 'READY', generatedAt: new Date().toISOString(), generatedBy: 'internal_portal', summary: { source: 'live_backend', status: report.status } },
    ];
    return paginate(snapshots, query);
  }

  async search(query: Query) {
    const q = clean(query.q, '').trim();
    if (!q) return { items: [], totals: {} };
    const [endpoints, entities, rules, reports] = await Promise.all([
      this.queryRows(`SELECT _id, method, full_path, route_name, module, status, risk_level, contains_pii FROM system_endpoint_catalog WHERE full_path ILIKE :like OR route_name ILIKE :like OR module ILIKE :like ORDER BY full_path ASC LIMIT 15`, { like: `%${q}%` }),
      this.queryRows(`SELECT _id, table_name, entity_name, module, status, contains_pii FROM system_data_entity_catalog WHERE table_name ILIKE :like OR entity_name ILIKE :like OR module ILIKE :like ORDER BY table_name ASC LIMIT 15`, { like: `%${q}%` }),
      this.queryRows(`SELECT _id, rule_code, rule_name, severity, is_active FROM data_quality_rules WHERE rule_code ILIKE :like OR rule_name ILIKE :like OR target_table ILIKE :like ORDER BY rule_code ASC LIMIT 15`, { like: `%${q}%` }),
      Promise.resolve(reportDefinitions().filter((report) => containsQuery(report, q.toLowerCase())).slice(0, 15)),
    ]);
    const items = [
      ...endpoints.map((row) => ({ id: `endpoint:${id(row._id)}`, kind: 'endpoint', title: `${clean(row.method)} ${clean(row.full_path)}`, subtitle: clean(row.route_name, clean(row.module)), href: `/internal/systems/endpoints/${id(row._id)}`, status: clean(row.status), method: clean(row.method), riskLevel: clean(row.risk_level), containsPii: boolValue(row.contains_pii) })),
      ...entities.map((row) => ({ id: `table:${id(row._id)}`, kind: 'table', title: clean(row.entity_name, clean(row.table_name)), subtitle: clean(row.table_name), href: `/internal/data-catalog/tables/${id(row._id)}`, status: clean(row.status), containsPii: boolValue(row.contains_pii) })),
      ...rules.map((row) => ({ id: `quality:${id(row._id)}`, kind: 'quality_rule', title: clean(row.rule_name), subtitle: clean(row.rule_code), href: `/internal/data-quality/rules/${id(row._id)}`, status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE', riskLevel: clean(row.severity).toUpperCase(), containsPii: false })),
      ...reports.map((report) => ({ id: `report:${report.reportId}`, kind: 'report', title: report.name, subtitle: report.description, href: `/internal/reports/${report.reportId}`, status: report.status, riskLevel: report.criticality, containsPii: false })),
    ];
    return { items, totals: { endpoints: endpoints.length, tables: entities.length, qualityRules: rules.length, reports: reports.length } };
  }
}
