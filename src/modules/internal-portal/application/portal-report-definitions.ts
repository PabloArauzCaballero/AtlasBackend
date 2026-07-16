import { Row } from './portal-format.util.js';

/**
 * Catálogo declarativo de reportes del portal interno.
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios: son datos estáticos
 * (definición de reportes, widgets y filtros), no lógica. Vivir aparte del servicio deja el código con
 * lógica de control legible y permite versionar el catálogo por separado.
 */

export type ReportDefinition = {
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

export const NOW_SEED = new Date('2026-01-01T00:00:00.000Z').toISOString();

export function reportDefinitions(): ReportDefinition[] {
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
        {
          widgetId: 'w-ops-counts',
          reportId: 'operations-overview',
          widgetType: 'metric_grid',
          title: 'Contadores operativos',
          description: 'Cobertura de catálogo y operación.',
          queryKey: 'opsCounts',
          visualConfig: {},
          position: { order: 1 },
        },
        {
          widgetId: 'w-open-issues',
          reportId: 'operations-overview',
          widgetType: 'table',
          title: 'Issues abiertos',
          description: 'Alertas de calidad no resueltas.',
          queryKey: 'openIssues',
          visualConfig: {},
          position: { order: 2 },
        },
      ],
      filters: [
        {
          filterId: 'f-date-from',
          reportId: 'operations-overview',
          key: 'from',
          label: 'Desde',
          filterType: 'date',
          required: false,
          options: [],
          defaultValue: null,
        },
        {
          filterId: 'f-date-to',
          reportId: 'operations-overview',
          key: 'to',
          label: 'Hasta',
          filterType: 'date',
          required: false,
          options: [],
          defaultValue: null,
        },
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
        {
          widgetId: 'w-endpoint-risk',
          reportId: 'endpoint-coverage',
          widgetType: 'bar',
          title: 'Endpoints por riesgo',
          description: 'Distribución por nivel de riesgo.',
          queryKey: 'endpointsByRisk',
          visualConfig: {},
          position: { order: 1 },
        },
        {
          widgetId: 'w-review-status',
          reportId: 'endpoint-coverage',
          widgetType: 'bar',
          title: 'Revisión',
          description: 'Estado de aprobación del catálogo.',
          queryKey: 'reviewStatus',
          visualConfig: {},
          position: { order: 2 },
        },
      ],
      filters: [
        {
          filterId: 'f-module',
          reportId: 'endpoint-coverage',
          key: 'module',
          label: 'Módulo',
          filterType: 'text',
          required: false,
          options: [],
          defaultValue: null,
        },
      ],
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
      widgets: [
        {
          widgetId: 'w-sensitive-fields',
          reportId: 'data-governance',
          widgetType: 'table',
          title: 'Campos sensibles',
          description: 'Reglas de acceso, masking y retención.',
          queryKey: 'sensitiveFields',
          visualConfig: {},
          position: { order: 1 },
        },
      ],
      filters: [
        {
          filterId: 'f-sensitivity',
          reportId: 'data-governance',
          key: 'sensitivityLevel',
          label: 'Sensibilidad',
          filterType: 'select',
          required: false,
          options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
          defaultValue: null,
        },
      ],
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
      widgets: [
        {
          widgetId: 'w-dq-open',
          reportId: 'risk-quality',
          widgetType: 'metric_grid',
          title: 'Calidad y riesgo',
          description: 'Issues abiertos y reglas activas.',
          queryKey: 'qualityRisk',
          visualConfig: {},
          position: { order: 1 },
        },
      ],
      filters: [
        {
          filterId: 'f-severity',
          reportId: 'risk-quality',
          key: 'severity',
          label: 'Severidad',
          filterType: 'select',
          required: false,
          options: ['low', 'medium', 'high', 'critical'],
          defaultValue: null,
        },
      ],
      updatedAt,
    },
  ];
}
