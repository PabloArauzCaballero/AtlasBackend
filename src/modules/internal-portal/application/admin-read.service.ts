/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { ReadQueryService } from '../../../common/database/read-query.service.js';
import {
  AuditEventViewQueryDto,
  CustomerViewQueryDto,
  EndpointCoverageViewQueryDto,
  NotificationViewQueryDto,
  ProviderHealthViewQueryDto,
  RiskViewQueryDto,
  WorkQueueViewQueryDto,
} from '../admin-read.schemas.js';

type ReadListQuery = {
  page: number;
  limit: number;
  fields?: string[];
  [key: string]: unknown;
};

type ViewConfig = {
  view: string;
  columns: Readonly<Record<string, string>>;
  defaultFields: readonly string[];
  orderBy: string;
  tenantScoped: boolean;
  buildFilters: (query: ReadListQuery, where: string[], replacements: Record<string, unknown>) => void;
};

const eq = (query: ReadListQuery, queryField: string, column: string, where: string[], replacements: Record<string, unknown>): void => {
  const value = query[queryField];
  if (value === undefined) return;
  const replacement = `filter_${queryField}`;
  where.push(`${column} = :${replacement}`);
  replacements[replacement] = value;
};

const ciEq = (query: ReadListQuery, queryField: string, column: string, where: string[], replacements: Record<string, unknown>): void => {
  const value = query[queryField];
  if (value === undefined) return;
  const replacement = `filter_${queryField}`;
  where.push(`lower(${column}) = lower(:${replacement})`);
  replacements[replacement] = value;
};

const CUSTOMER_VIEW: ViewConfig = {
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
  buildFilters: (query, where, replacements) => {
    ciEq(query, 'status', 'lifecycle_status', where, replacements);
    ciEq(query, 'riskBand', 'latest_risk_band', where, replacements);
    if (typeof query.q === 'string') {
      where.push(`(customer_code ILIKE :search OR COALESCE(display_name, '') ILIKE :search)`);
      replacements.search = `%${query.q}%`;
    }
  },
};

const RISK_VIEW: ViewConfig = {
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
  buildFilters: (query, where, replacements) => {
    eq(query, 'customerId', 'customer_id', where, replacements);
    ciEq(query, 'status', 'status', where, replacements);
    ciEq(query, 'riskBand', 'risk_band', where, replacements);
    ciEq(query, 'decision', 'decision', where, replacements);
  },
};

const WORK_QUEUE_VIEW: ViewConfig = {
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
  buildFilters: (query, where, replacements) => {
    ciEq(query, 'type', 'queue_item_type', where, replacements);
    ciEq(query, 'status', 'status', where, replacements);
    ciEq(query, 'priority', 'priority', where, replacements);
    ciEq(query, 'severity', 'severity', where, replacements);
    eq(query, 'assignedTo', 'assigned_to', where, replacements);
  },
};

const PROVIDER_VIEW: ViewConfig = {
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
  buildFilters: (query, where, replacements) => {
    ciEq(query, 'healthStatus', 'health_status', where, replacements);
    ciEq(query, 'providerStatus', 'provider_status', where, replacements);
  },
};

const NOTIFICATION_VIEW: ViewConfig = {
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
  buildFilters: (query, where, replacements) => {
    ciEq(query, 'status', 'status', where, replacements);
    ciEq(query, 'channel', 'channel', where, replacements);
    ciEq(query, 'category', 'category', where, replacements);
  },
};

const ENDPOINT_VIEW: ViewConfig = {
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
  buildFilters: (query, where, replacements) => {
    ciEq(query, 'module', 'module', where, replacements);
    ciEq(query, 'riskLevel', 'risk_level', where, replacements);
    ciEq(query, 'reviewStatus', 'review_status', where, replacements);
    eq(query, 'releaseReady', 'release_ready', where, replacements);
  },
};

const AUDIT_VIEW: ViewConfig = {
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
  buildFilters: (query, where, replacements) => {
    ciEq(query, 'eventType', 'event_type', where, replacements);
    ciEq(query, 'actorType', 'actor_type', where, replacements);
    ciEq(query, 'targetType', 'target_type', where, replacements);
  },
};

@Injectable()
export class AdminReadService {
  constructor(private readonly readQuery: ReadQueryService) {}

  listCustomers(tenantId: string, query: CustomerViewQueryDto) {
    return this.list(CUSTOMER_VIEW, query, tenantId);
  }

  listRiskAssessments(tenantId: string, query: RiskViewQueryDto) {
    return this.list(RISK_VIEW, query, tenantId);
  }

  listWorkQueue(tenantId: string, query: WorkQueueViewQueryDto) {
    return this.list(WORK_QUEUE_VIEW, query, tenantId);
  }

  listProviderHealth(query: ProviderHealthViewQueryDto) {
    return this.list(PROVIDER_VIEW, query);
  }

  listNotificationDeliveries(tenantId: string, query: NotificationViewQueryDto) {
    return this.list(NOTIFICATION_VIEW, query, tenantId);
  }

  listEndpointCoverage(query: EndpointCoverageViewQueryDto) {
    return this.list(ENDPOINT_VIEW, query);
  }

  listAuditEvents(tenantId: string, query: AuditEventViewQueryDto) {
    return this.list(AUDIT_VIEW, query, tenantId);
  }

  private async list(config: ViewConfig, query: ReadListQuery, tenantId?: string) {
    const selectedFields = query.fields ?? [...config.defaultFields];
    const unknownFields = selectedFields.filter((field) => !Object.hasOwn(config.columns, field));
    if (unknownFields.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_VIEW_FIELDS',
        message: `Campos no permitidos: ${unknownFields.join(', ')}.`,
        allowedFields: Object.keys(config.columns),
      });
    }

    if (config.tenantScoped && !tenantId) {
      throw new BadRequestException('La vista requiere un tenant explícito.');
    }

    const where: string[] = [];
    const replacements: Record<string, unknown> = {
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    };
    if (config.tenantScoped) {
      where.push('tenant_id = :tenantId');
      replacements.tenantId = tenantId;
    }
    config.buildFilters(query, where, replacements);

    const projection = selectedFields.map((field) => `${config.columns[field]} AS "${field}"`).join(', ');
    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const [items, totals] = await Promise.all([
      this.readQuery.select<Record<string, unknown>>(
        `SELECT ${projection} FROM ${config.view}${whereSql} ORDER BY ${config.orderBy} LIMIT :limit OFFSET :offset`,
        replacements,
      ),
      this.readQuery.select<{ count: string }>(`SELECT COUNT(*)::text AS "count" FROM ${config.view}${whereSql}`, replacements),
    ]);
    const total = Number(totals[0]?.count ?? 0);

    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
        selectedFields,
      },
    };
  }
}
