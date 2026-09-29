/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system declara las siete vistas de `read_api`: columnas, orden, buscador y filtros de cada una.
 */

export type ReadListQuery = {
  page: number;
  limit: number;
  fields?: string[];
  [key: string]: unknown;
};

/**
 * Una vista gobernada, declarada y no programada.
 *
 * - `search`: columnas donde busca `q` (ILIKE, con `%` y `_` escapados). Antes sólo «Clientes»
 *   tenía buscador; las demás rechazaban `q` con 400 y la pantalla mostraba la caja deshabilitada.
 * - `facets`: filtro → columna, comparado sin distinguir mayúsculas. Son también las columnas cuyos
 *   valores publica `/internal/views/:view/facets`, para que el desplegable no salga de la página.
 * - `exact`: filtro → columna comparada tal cual (ids numéricos y booleanos).
 */
export type ViewConfig = {
  view: string;
  columns: Readonly<Record<string, string>>;
  defaultFields: readonly string[];
  orderBy: string;
  tenantScoped: boolean;
  search: readonly string[];
  facets: Readonly<Record<string, string>>;
  exact?: Readonly<Record<string, string>>;
};

export const CUSTOMER_VIEW: ViewConfig = {
  view: 'read_api.v_customer_overview_v1',
  columns: {
    customerId: 'customer_id',
    customerCode: 'customer_code',
    customerUuid: 'customer_uuid',
    lifecycleStatus: 'lifecycle_status',
    displayName: 'display_name',
    birthDate: 'birth_date',
    preferredLanguage: 'preferred_language',
    primaryEmailDomain: 'primary_email_domain',
    primaryPhoneLast4: 'primary_phone_last_4',
    latestRiskAssessmentRunId: 'latest_risk_assessment_run_id',
    latestRiskDecision: 'latest_risk_decision',
    latestRiskBand: 'latest_risk_band',
    latestRiskScore: 'latest_risk_score',
    latestRiskDecidedAt: 'latest_risk_decided_at',
    activeConsentCount: 'active_consent_count',
    activeDeviceCount: 'active_device_count',
    openManualReviewCount: 'open_manual_review_count',
    openFraudCaseCount: 'open_fraud_case_count',
    lastActivityAt: 'last_activity_at',
  },
  defaultFields: [
    'customerId',
    'customerCode',
    'lifecycleStatus',
    'displayName',
    'latestRiskDecision',
    'latestRiskBand',
    'latestRiskScore',
    'openManualReviewCount',
    'openFraudCaseCount',
    'lastActivityAt',
  ],
  orderBy: 'last_activity_at DESC NULLS LAST, customer_id DESC',
  tenantScoped: true,
  search: ['customer_code', 'display_name'],
  facets: { status: 'lifecycle_status', riskBand: 'latest_risk_band' },
};

export const RISK_VIEW: ViewConfig = {
  view: 'read_api.v_risk_assessment_summary_v1',
  columns: {
    riskAssessmentRunId: 'risk_assessment_run_id',
    customerId: 'customer_id',
    status: 'status',
    assessmentType: 'assessment_type',
    requestedAt: 'requested_at',
    completedAt: 'completed_at',
    decidedAt: 'decided_at',
    modelVersionCode: 'model_version_code',
    rulesetVersionCode: 'ruleset_version_code',
    score: 'score',
    riskBand: 'risk_band',
    decision: 'decision',
    reasonCodes: 'reason_codes_json',
    manualReviewRequired: 'manual_review_required',
    hardStopTriggered: 'hard_stop_triggered',
  },
  defaultFields: [
    'riskAssessmentRunId',
    'customerId',
    'status',
    'assessmentType',
    'decidedAt',
    'score',
    'riskBand',
    'decision',
    'manualReviewRequired',
    'hardStopTriggered',
  ],
  orderBy: 'COALESCE(decided_at, requested_at) DESC NULLS LAST, risk_assessment_run_id DESC',
  tenantScoped: true,
  search: ['assessment_type', 'model_version_code', 'ruleset_version_code'],
  facets: { status: 'status', riskBand: 'risk_band', decision: 'decision' },
  exact: { customerId: 'customer_id' },
};

export const WORK_QUEUE_VIEW: ViewConfig = {
  view: 'read_api.v_operations_work_queue_v1',
  columns: {
    type: 'queue_item_type',
    itemId: 'queue_item_id',
    customerId: 'customer_id',
    status: 'status',
    priority: 'priority',
    severity: 'severity',
    reasonCode: 'reason_code',
    assignedTo: 'assigned_to',
    createdAt: 'created_at',
    dueAt: 'due_at',
    updatedAt: 'updated_at',
  },
  defaultFields: ['type', 'itemId', 'customerId', 'status', 'priority', 'severity', 'reasonCode', 'assignedTo', 'createdAt', 'dueAt'],
  orderBy: 'priority DESC NULLS LAST, created_at ASC NULLS LAST, queue_item_type, queue_item_id',
  tenantScoped: true,
  search: ['reason_code', 'queue_item_id'],
  facets: { type: 'queue_item_type', status: 'status', priority: 'priority', severity: 'severity' },
  exact: { assignedTo: 'assigned_to' },
};

export const PROVIDER_VIEW: ViewConfig = {
  view: 'read_api.v_provider_health_latest_v1',
  columns: {
    providerId: 'provider_id',
    providerCode: 'provider_code',
    providerName: 'provider_name',
    providerStatus: 'provider_status',
    healthStatus: 'health_status',
    modeChecked: 'mode_checked',
    latencyMs: 'latency_ms',
    checkedAt: 'checked_at',
    errorCode: 'error_code',
  },
  defaultFields: Object.freeze([
    'providerId',
    'providerCode',
    'providerName',
    'providerStatus',
    'healthStatus',
    'modeChecked',
    'latencyMs',
    'checkedAt',
    'errorCode',
  ]),
  orderBy: 'provider_code ASC, provider_id ASC',
  tenantScoped: false,
  search: ['provider_code', 'provider_name', 'error_code'],
  facets: { healthStatus: 'health_status', providerStatus: 'provider_status' },
};

export const NOTIFICATION_VIEW: ViewConfig = {
  view: 'read_api.v_notification_delivery_summary_v1',
  columns: {
    messageId: 'message_id',
    templateCode: 'template_code',
    channel: 'channel',
    recipientType: 'recipient_type',
    category: 'category',
    status: 'status',
    priority: 'priority',
    createdAt: 'created_at',
    scheduledAt: 'scheduled_at',
    sentAt: 'sent_at',
    deliveredAt: 'delivered_at',
    failedAt: 'failed_at',
    attemptCount: 'attempt_count',
    deliveredCount: 'delivered_count',
    failedCount: 'failed_count',
    lastAttemptAt: 'last_attempt_at',
    lastErrorCode: 'last_error_code',
  },
  defaultFields: [
    'messageId',
    'templateCode',
    'channel',
    'category',
    'status',
    'priority',
    'createdAt',
    'attemptCount',
    'deliveredCount',
    'failedCount',
    'lastAttemptAt',
    'lastErrorCode',
  ],
  orderBy: 'created_at DESC NULLS LAST, message_id DESC',
  tenantScoped: true,
  search: ['template_code', 'last_error_code'],
  facets: { status: 'status', channel: 'channel', category: 'category' },
};

export const ENDPOINT_VIEW: ViewConfig = {
  view: 'read_api.v_system_endpoint_coverage_v1',
  columns: {
    endpointId: 'endpoint_id',
    method: 'method',
    fullPath: 'full_path',
    module: 'module',
    riskLevel: 'risk_level',
    reviewStatus: 'review_status',
    requiresAuth: 'requires_auth',
    containsPii: 'contains_pii',
    readonly: 'is_readonly',
    destructive: 'is_destructive',
    sensitiveFieldCount: 'sensitive_field_count',
    dataEntityCount: 'data_entity_count',
    moduleTestSuiteCount: 'module_test_suite_count',
    releaseReady: 'release_ready',
  },
  defaultFields: Object.freeze([
    'endpointId',
    'method',
    'fullPath',
    'module',
    'riskLevel',
    'reviewStatus',
    'containsPii',
    'sensitiveFieldCount',
    'dataEntityCount',
    'moduleTestSuiteCount',
    'releaseReady',
  ]),
  orderBy: 'module ASC, full_path ASC, method ASC',
  tenantScoped: false,
  search: ['full_path', 'method'],
  facets: { module: 'module', riskLevel: 'risk_level', reviewStatus: 'review_status' },
  exact: { releaseReady: 'release_ready' },
};

export const AUDIT_VIEW: ViewConfig = {
  view: 'read_api.v_audit_event_feed_v1',
  columns: {
    sourceTable: 'source_table',
    sourceId: 'source_id',
    occurredAt: 'occurred_at',
    actorType: 'actor_type',
    eventType: 'event_type',
    targetType: 'target_type',
    targetId: 'target_id',
  },
  defaultFields: ['sourceTable', 'sourceId', 'occurredAt', 'actorType', 'eventType', 'targetType', 'targetId'],
  orderBy: 'occurred_at DESC, source_table ASC, source_id DESC',
  tenantScoped: true,
  search: ['event_type', 'target_type', 'target_id', 'source_table'],
  facets: { eventType: 'event_type', actorType: 'actor_type', targetType: 'target_type' },
};

/** Las siete vistas por la clave que usa la URL (`/internal/views/:view`). */
export const GOVERNED_VIEWS = {
  customers: CUSTOMER_VIEW,
  'risk-assessments': RISK_VIEW,
  'work-queue': WORK_QUEUE_VIEW,
  'provider-health': PROVIDER_VIEW,
  'notification-deliveries': NOTIFICATION_VIEW,
  'endpoint-coverage': ENDPOINT_VIEW,
  'audit-events': AUDIT_VIEW,
} as const satisfies Record<string, ViewConfig>;

export type GovernedViewKey = keyof typeof GOVERNED_VIEWS;
export const GOVERNED_VIEW_KEYS = Object.keys(GOVERNED_VIEWS) as GovernedViewKey[];

/** Tope de valores distintos por filtro: un desplegable de miles de opciones no se puede usar. */
export const FACET_VALUE_LIMIT = 200;

/**
 * Añade a `where` los filtros declarados de la vista. Todo valor viaja como reemplazo con nombre;
 * los nombres de columna salen de la declaración de arriba, nunca de la petición.
 */
export function buildViewFilters(config: ViewConfig, query: ReadListQuery, where: string[], replacements: Record<string, unknown>): void {
  for (const [name, column] of Object.entries(config.exact ?? {})) {
    if (query[name] === undefined) continue;
    where.push(`${column} = :filter_${name}`);
    replacements[`filter_${name}`] = query[name];
  }
  for (const [name, column] of Object.entries(config.facets)) {
    if (query[name] === undefined) continue;
    where.push(`lower(${column}::text) = lower(:filter_${name})`);
    replacements[`filter_${name}`] = query[name];
  }
  if (typeof query.q === 'string' && query.q.length > 0) {
    where.push(`(${config.search.map((column) => `COALESCE(${column}::text, '') ILIKE :search`).join(' OR ')})`);
    replacements.search = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  }
}
