import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { QueryInterface } from 'sequelize';
import { SYSTEM_TOOL_SEEDS } from '../../../modules/systems-ops/systems-ops.constants.js';
import { EndpointSeed } from '../../../modules/systems-ops/systems-ops.types.js';
import { buildEndpointCode, moduleFromPath, routeNameFromMethodAndPath } from '../../../modules/systems-ops/endpoint-code.util.js';
import { CURATED_ENDPOINTS, STRESS_PROFILE_SEEDS } from '../../../modules/systems-ops/systems-seed-fixtures.js';

type SeedContext = { context: QueryInterface };

type DataEntityClassification = ReturnType<typeof classifyTable>;

type TestStepSeed = {
  name: string;
  method: string;
  pathTemplate: string;
  defaultHeaders?: Record<string, unknown>;
  defaultPayload?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  assertions?: Record<string, unknown>;
  extractors?: Record<string, unknown>;
  inputMode?: 'DEFAULT' | 'CONFIGURABLE' | 'GENERATED' | 'FROM_PREVIOUS_STEP';
  continueOnFailure?: boolean;
  cleanupRequired?: boolean;
};

type TestSuiteSeed = {
  code: string;
  name: string;
  description: string;
  module: string;
  suiteType: 'SMOKE' | 'INTEGRATION' | 'REGRESSION' | 'E2E_API' | 'LOAD';
  isSafeForProduction?: boolean;
  requiresDestructivePermission?: boolean;
  steps: TestStepSeed[];
};

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const API_PREFIX = `/${(process.env.API_PREFIX ?? 'api/v1').replace(/^\/+|\/+$/g, '')}`;

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function jsonArray(value: unknown[]): string {
  return JSON.stringify(value ?? []);
}

function normalizeRoutePart(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/['"`]([^'"`]*)['"`]/);
  return (match?.[1] ?? '').replace(/^\/+|\/+$/g, '');
}

function joinPaths(...parts: string[]): string {
  const joined = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${joined}`.replace(/\/+/g, '/');
}

function pathParamsFromPath(path: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    params[match[1]] = match[1].toLowerCase().endsWith('id') ? 'positive integer|required' : 'string|required';
  }
  return params;
}

function defaultExpectedStatuses(method: string, path: string): number[] {
  if (path.includes('/health')) return [200, 503];
  if (method === 'POST') return [200, 201, 400, 401, 403, 409, 422];
  if (method === 'PATCH' || method === 'PUT') return [200, 400, 401, 403, 404, 422];
  if (method === 'DELETE') return [200, 204, 400, 401, 403, 404];
  return [200, 400, 401, 403, 404];
}

function defaultAllowedRoles(path: string): string[] {
  if (path.includes('/internal/') || path.includes('/systems')) return ['SUPER_ADMIN', 'SYSTEMS_ADMIN'];
  if (path.includes('/operations/data-governance')) return ['SUPER_ADMIN', 'DATA_GOVERNANCE_MANAGER', 'COMPLIANCE_ANALYST'];
  if (path.includes('/operations/risk') || path.includes('/risk-assessments')) return ['SUPER_ADMIN', 'RISK_ANALYST', 'RISK_MANAGER'];
  if (path.includes('/operations')) return ['SUPER_ADMIN', 'OPERATIONS_ANALYST', 'RISK_ANALYST'];
  if (path.includes('/external-data')) return ['SUPER_ADMIN', 'RISK_ANALYST', 'COMPLIANCE_ANALYST'];
  return ['AUTHENTICATED_USER'];
}

function containsPiiForEndpoint(path: string): boolean {
  return /customer|identity|contact|auth|consent|privacy|device-token|session|external-data|notification/i.test(path);
}

function riskLevelForEndpoint(method: string, path: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (
    /login|risk-assessments|provision-credentials|signup|decision|kill-switch|runtime|policy-package|apply-retention|device-token/i.test(
      path,
    )
  ) {
    return 'CRITICAL';
  }
  if (method !== 'GET') return 'HIGH';
  if (/systems|operations|external-data|data-governance|audit|notifications|sessions/i.test(path)) return 'HIGH';
  if (/health|catalog|definitions/i.test(path)) return 'MEDIUM';
  return 'LOW';
}

function businessPurposeForEndpoint(method: string, path: string, handlerName?: string | null): string {
  if (path === `${API_PREFIX}/health`) return 'Verificar salud técnica del backend y disponibilidad mínima para despliegue/pruebas.';
  if (path.includes('/auth/login')) return 'Autenticar usuarios y registrar la entrada segura al sistema.';
  if (path.includes('/systems/endpoints'))
    return 'Administrar documentación viva de rutas, payload mínimo, respuesta esperada y revisión técnica.';
  if (path.includes('/systems/data-entities'))
    return 'Documentar tablas/modelos, propósito de negocio, clasificación y criticidad de datos.';
  if (path.includes('/systems/tools')) return 'Documentar herramientas técnicas y dependencias requeridas por endpoints.';
  if (path.includes('/systems/test-suites')) return 'Gestionar suites y pasos de prueba ejecutables desde el portal administrativo.';
  if (path.includes('/systems/stress')) return 'Gestionar perfiles de stress y matriz de carga segura para endpoints críticos.';
  if (path.includes('/customer-onboarding')) return 'Ejecutar pasos de onboarding, verificación, identidad y dirección del cliente.';
  if (path.includes('/risk-assessments')) return 'Consultar o ejecutar evaluación de riesgo/scoring y explicación de decisión.';
  if (path.includes('/operations/work-queue')) return 'Mostrar cola operativa consolidada de casos de riesgo, fraude y calidad.';
  if (path.includes('/manual-review-cases')) return 'Gestionar revisión manual de clientes/casos que requieren decisión humana.';
  if (path.includes('/fraud-cases')) return 'Gestionar investigación y decisión de casos de fraude.';
  if (path.includes('/operations/catalogs')) return 'Gestionar catálogos funcionales usados por formularios, scoring y gobierno de datos.';
  if (path.includes('/operations/definitions')) return 'Gestionar definiciones de observaciones, atributos, eventos y features de scoring.';
  if (path.includes('/data-governance')) return 'Gestionar políticas de privacidad, retención, clasificación y campos sensibles.';
  if (path.includes('/external-data'))
    return 'Orquestar proveedores externos, consentimientos, solicitudes, mocks, health y paquetes de decisión.';
  if (path.includes('/notifications')) return 'Gestionar mensajes, plantillas, preferencias, entregas y tokens de notificación.';
  if (path.includes('/sessions')) return 'Gestionar sesiones, heartbeats, cierre, estado e investigación de sesión/dispositivo.';
  if (path.includes('/telemetry')) return 'Ingerir telemetría de comportamiento/dispositivo para señales de riesgo gobernadas.';
  if (path.includes('/privacy')) return 'Gestionar decisiones de consentimiento y solicitudes de titular de datos.';
  if (path.includes('/audit')) return 'Consultar bitácora y feed de auditoría operacional.';
  if (path.includes('/events') || path.includes('/jobs')) return 'Administrar eventos internos, outbox y jobs de mantenimiento operativo.';
  return `${method} ${path}: endpoint detectado desde controlador${handlerName ? ` (${handlerName})` : ''} y documentado para pruebas/gobierno.`;
}

function expectedResponseSummaryForEndpoint(method: string, path: string): string {
  if (method === 'GET') return 'Respuesta de lectura paginada o detalle sanitizado, sin secretos ni payloads crudos sensibles.';
  if (path.includes('/run') || path.includes('/queue'))
    return 'Resultado de ejecución/encolado con identificador de tracking y estado inicial.';
  if (path.includes('/decision')) return 'Resultado de decisión, estado actualizado, razón segura y auditoría asociada.';
  if (method === 'DELETE') return 'Confirmación de baja lógica/física según endpoint y auditoría asociada.';
  return 'Recurso creado o actualizado con identificador, estado y resumen seguro.';
}

function routePathFromFullPath(fullPath: string): string {
  const api = new RegExp(`^${API_PREFIX.replace(/\//g, '\\/')}`);
  const route = fullPath.replace(api, '');
  return route.length > 0 ? route : '/';
}

function discoverEndpoints(): EndpointSeed[] {
  const modulesDir = join(process.cwd(), 'src', 'modules');
  if (!existsSync(modulesDir)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      if (entry.isFile() && entry.name.endsWith('controller.ts')) files.push(path);
    }
  };
  walk(modulesDir);

  const endpoints: EndpointSeed[] = [];
  for (const file of files.sort()) {
    const source = readFileSync(file, 'utf8');
    const controllerName = source.match(/export\s+class\s+([A-Za-z0-9_]+)/)?.[1] ?? null;
    const controllerPath = normalizeRoutePart(source.match(/@Controller\(([^)]*)\)/s)?.[1]);
    const lines = source.split('\n');
    const pending: Array<{ method: string; path: string }> = [];

    for (const line of lines) {
      const decorator = line.match(/@(Get|Post|Put|Patch|Delete|Options|Head)\(([^)]*)\)/);
      if (decorator) {
        pending.push({ method: decorator[1].toUpperCase(), path: normalizeRoutePart(decorator[2]) });
        continue;
      }

      const handler = line.match(/^\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\(/);
      if (!handler || pending.length === 0) continue;
      for (const route of pending.splice(0)) {
        const fullPath = joinPaths(API_PREFIX, controllerPath, route.path);
        const method = route.method;
        endpoints.push({
          code: buildEndpointCode(method, fullPath),
          module: moduleFromPath(fullPath),
          controllerName,
          handlerName: handler[1],
          method,
          fullPath,
          routeName: routeNameFromMethodAndPath(method, fullPath),
          businessPurpose: businessPurposeForEndpoint(method, fullPath, handler[1]),
          businessAction: `${method} ${fullPath} ejecuta ${handler[1]} desde ${controllerName ?? 'controller'} para el módulo ${moduleFromPath(fullPath)}.`,
          expectedResponseSummary: expectedResponseSummaryForEndpoint(method, fullPath),
          expectedStatusCodes: defaultExpectedStatuses(method, fullPath),
          minPayloadSchema: method === 'GET' ? {} : { seedPayload: 'configurable_from_portal' },
          queryParamsSchema: method === 'GET' ? { page: 'number|optional', limit: 'number|optional', filters: 'object|optional' } : {},
          pathParamsSchema: pathParamsFromPath(fullPath),
          headersSchema: {
            authorization: fullPath.includes('/health') || fullPath.includes('/auth/login') ? 'not required' : 'Bearer token|required',
          },
          requiresAuth: !(fullPath.includes('/health') || fullPath.endsWith('/auth/login') || fullPath.endsWith('/internal/auth/login')),
          allowedRoles:
            fullPath.includes('/health') || fullPath.endsWith('/auth/login') || fullPath.endsWith('/internal/auth/login')
              ? []
              : defaultAllowedRoles(fullPath),
          containsPii: containsPiiForEndpoint(fullPath),
          piiFields: containsPiiForEndpoint(fullPath) ? ['customerId', 'documentNumber', 'phone', 'email', 'token'] : [],
          riskLevel: riskLevelForEndpoint(method, fullPath),
          isDestructive: method === 'DELETE' || /kill-switch|cancel|apply-retention|decision/i.test(fullPath),
          isReadonly: method === 'GET',
          idempotencyRequired: method !== 'GET' && method !== 'DELETE',
          requiresStressTest:
            method === 'GET' || /login|onboarding|risk-assessments|work-queue|systems\/endpoints|providers\/health/i.test(fullPath),
          requiresIntegrationTest: true,
          isTestableFromPortal: !/callback|device-tokens|logout|refresh/i.test(fullPath),
          testEnvironmentOnly: !method.includes('GET') || !fullPath.includes('/health'),
          detectedFrom: 'controller_seed',
          confidenceLevel: 'MEDIUM',
          reviewStatus: 'AUTO_DETECTED',
          sourceFile: relative(process.cwd(), file),
        });
      }
    }
  }
  return endpoints;
}

function mergedEndpoints(): EndpointSeed[] {
  const map = new Map<string, EndpointSeed>();
  for (const endpoint of discoverEndpoints()) map.set(`${endpoint.method} ${endpoint.fullPath}`, endpoint);
  for (const endpoint of CURATED_ENDPOINTS) {
    const key = `${endpoint.method} ${endpoint.fullPath}`;
    const discovered = map.get(key);
    map.set(key, {
      ...discovered,
      ...endpoint,
      detectedFrom: endpoint.detectedFrom ?? 'manual_seed',
      confidenceLevel: endpoint.confidenceLevel ?? 'HIGH',
      reviewStatus: endpoint.reviewStatus ?? 'APPROVED',
      expectedStatusCodes:
        endpoint.expectedStatusCodes ?? discovered?.expectedStatusCodes ?? defaultExpectedStatuses(endpoint.method, endpoint.fullPath),
      pathParamsSchema: endpoint.pathParamsSchema ?? discovered?.pathParamsSchema ?? pathParamsFromPath(endpoint.fullPath),
      queryParamsSchema: endpoint.queryParamsSchema ?? discovered?.queryParamsSchema ?? {},
      headersSchema: endpoint.headersSchema ?? discovered?.headersSchema ?? {},
      allowedRoles: endpoint.allowedRoles ?? discovered?.allowedRoles ?? defaultAllowedRoles(endpoint.fullPath),
      piiFields: endpoint.piiFields ?? discovered?.piiFields ?? [],
      riskLevel: endpoint.riskLevel ?? discovered?.riskLevel ?? riskLevelForEndpoint(endpoint.method, endpoint.fullPath),
    });
  }
  return [...map.values()].sort((a, b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method));
}

function classifyTable(tableName: string, modelName: string | null) {
  const normalized = tableName.toLowerCase();
  const containsPii = /customer|identity|contact|auth|consent|privacy|address|evidence|document|phone|email|session|token/.test(normalized);
  const containsRiskData = /risk|fraud|watchlist|feature|score|observation|quality|provider|reputation|sim|ip_/.test(normalized);
  const containsLegalData = /consent|privacy|retention|classification|sensitive|subject_request/.test(normalized);
  const containsDeviceData = /device|fingerprint|sim|ip_reputation|telemetry|metric|behavior/.test(normalized);
  const containsLocationData = /gps|address|location/.test(normalized);
  const containsFinancialData = /payment|purchase|installment|credit|limit|settlement|merchant|mdr|loan|debt|collection/.test(normalized);
  const isAuditCritical =
    /audit|log|event|outbox|job|idempotency|change/.test(normalized) || containsPii || containsRiskData || containsFinancialData;
  const module = normalized.includes('system')
    ? 'systems'
    : normalized.includes('risk') || normalized.includes('feature')
      ? 'risk'
      : normalized.includes('provider')
        ? 'external_data'
        : normalized.includes('notification')
          ? 'notifications'
          : normalized.includes('customer')
            ? 'customers'
            : normalized.includes('context') || normalized.includes('definition')
              ? 'catalog_management'
              : 'operations';
  const entityName = tableName
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return {
    tableName,
    modelName,
    entityName,
    module,
    containsPii,
    containsRiskData,
    containsLegalData,
    containsDeviceData,
    containsLocationData,
    containsFinancialData,
    isAuditCritical,
  };
}

async function upsertTool(queryInterface: QueryInterface, tool: (typeof SYSTEM_TOOL_SEEDS)[number]) {
  await queryInterface.sequelize.query(
    `INSERT INTO system_tool_catalog (
      code, name, type, provider, purpose, required_env_vars, has_sandbox, healthcheck_route,
      requires_credentials, is_critical, is_worker, status, owner_team, _created_at, _updated_at
    ) VALUES (
      :code, :name, :type, :provider, :purpose, CAST(:requiredEnvVars AS jsonb), :hasSandbox, :healthcheckRoute,
      :requiresCredentials, :isCritical, :isWorker, :status, :ownerTeam, :createdAt, :createdAt
    ) ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      provider = EXCLUDED.provider,
      purpose = EXCLUDED.purpose,
      required_env_vars = EXCLUDED.required_env_vars,
      has_sandbox = EXCLUDED.has_sandbox,
      healthcheck_route = EXCLUDED.healthcheck_route,
      requires_credentials = EXCLUDED.requires_credentials,
      is_critical = EXCLUDED.is_critical,
      is_worker = EXCLUDED.is_worker,
      status = EXCLUDED.status,
      owner_team = EXCLUDED.owner_team,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        ...tool,
        provider: tool.provider ?? null,
        requiredEnvVars: jsonArray(tool.requiredEnvVars ?? []),
        hasSandbox: tool.hasSandbox ?? false,
        healthcheckRoute: tool.healthcheckRoute ?? null,
        requiresCredentials: tool.requiresCredentials ?? false,
        isCritical: tool.isCritical ?? false,
        isWorker: tool.isWorker ?? false,
        status: tool.status ?? 'ACTIVE',
        ownerTeam: tool.ownerTeam ?? 'systems',
        createdAt: CREATED_AT,
      },
    },
  );
}

async function upsertEndpoint(queryInterface: QueryInterface, endpoint: EndpointSeed) {
  const method = endpoint.method.toUpperCase();
  const fullPath = endpoint.fullPath;
  await queryInterface.sequelize.query(
    `INSERT INTO system_endpoint_catalog (
      code, module, controller_name, handler_name, method, route_path, full_path, route_name, business_purpose,
      business_action, expected_response_summary, expected_status_codes, min_payload_schema, query_params_schema,
      path_params_schema, headers_schema, requires_auth, allowed_roles, contains_pii, pii_fields, risk_level,
      is_destructive, is_readonly, idempotency_required, requires_stress_test, requires_integration_test,
      is_testable_from_portal, test_environment_only, owner_team, status, version, detected_from, confidence_level,
      review_status, source_file, created_by, updated_by, _created_at, _updated_at
    ) VALUES (
      :code, :module, :controllerName, :handlerName, :method, :routePath, :fullPath, :routeName, :businessPurpose,
      :businessAction, :expectedResponseSummary, CAST(:expectedStatusCodes AS jsonb), CAST(:minPayloadSchema AS jsonb), CAST(:queryParamsSchema AS jsonb),
      CAST(:pathParamsSchema AS jsonb), CAST(:headersSchema AS jsonb), :requiresAuth, CAST(:allowedRoles AS jsonb), :containsPii, CAST(:piiFields AS jsonb), :riskLevel,
      :isDestructive, :isReadonly, :idempotencyRequired, :requiresStressTest, :requiresIntegrationTest,
      :isTestableFromPortal, :testEnvironmentOnly, :ownerTeam, :status, 'v1', :detectedFrom, :confidenceLevel,
      :reviewStatus, :sourceFile, 'system_seed', 'system_seed', :createdAt, :createdAt
    ) ON CONFLICT (method, full_path) DO UPDATE SET
      code = EXCLUDED.code,
      module = EXCLUDED.module,
      controller_name = COALESCE(EXCLUDED.controller_name, system_endpoint_catalog.controller_name),
      handler_name = COALESCE(EXCLUDED.handler_name, system_endpoint_catalog.handler_name),
      route_name = EXCLUDED.route_name,
      business_purpose = EXCLUDED.business_purpose,
      business_action = EXCLUDED.business_action,
      expected_response_summary = EXCLUDED.expected_response_summary,
      expected_status_codes = EXCLUDED.expected_status_codes,
      min_payload_schema = EXCLUDED.min_payload_schema,
      query_params_schema = EXCLUDED.query_params_schema,
      path_params_schema = EXCLUDED.path_params_schema,
      headers_schema = EXCLUDED.headers_schema,
      requires_auth = EXCLUDED.requires_auth,
      allowed_roles = EXCLUDED.allowed_roles,
      contains_pii = EXCLUDED.contains_pii,
      pii_fields = EXCLUDED.pii_fields,
      risk_level = EXCLUDED.risk_level,
      is_destructive = EXCLUDED.is_destructive,
      is_readonly = EXCLUDED.is_readonly,
      idempotency_required = EXCLUDED.idempotency_required,
      requires_stress_test = EXCLUDED.requires_stress_test,
      requires_integration_test = EXCLUDED.requires_integration_test,
      is_testable_from_portal = EXCLUDED.is_testable_from_portal,
      test_environment_only = EXCLUDED.test_environment_only,
      owner_team = EXCLUDED.owner_team,
      status = EXCLUDED.status,
      detected_from = EXCLUDED.detected_from,
      confidence_level = EXCLUDED.confidence_level,
      review_status = EXCLUDED.review_status,
      source_file = COALESCE(EXCLUDED.source_file, system_endpoint_catalog.source_file),
      updated_by = 'system_seed',
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        code: endpoint.code ?? buildEndpointCode(method, fullPath),
        module: endpoint.module ?? moduleFromPath(fullPath),
        controllerName: endpoint.controllerName ?? null,
        handlerName: endpoint.handlerName ?? null,
        method,
        routePath: routePathFromFullPath(fullPath),
        fullPath,
        routeName: endpoint.routeName ?? routeNameFromMethodAndPath(method, fullPath),
        businessPurpose: endpoint.businessPurpose,
        businessAction: endpoint.businessAction ?? `${method} ${fullPath}: acción documentada desde seed de catálogo.`,
        expectedResponseSummary: endpoint.expectedResponseSummary ?? expectedResponseSummaryForEndpoint(method, fullPath),
        expectedStatusCodes: jsonArray(endpoint.expectedStatusCodes ?? defaultExpectedStatuses(method, fullPath)),
        minPayloadSchema: json(endpoint.minPayloadSchema ?? (method === 'GET' ? {} : { seedPayload: 'configurable_from_portal' })),
        queryParamsSchema: json(endpoint.queryParamsSchema ?? {}),
        pathParamsSchema: json(endpoint.pathParamsSchema ?? pathParamsFromPath(fullPath)),
        headersSchema: json(endpoint.headersSchema ?? {}),
        requiresAuth: endpoint.requiresAuth ?? !(fullPath.includes('/health') || fullPath.endsWith('/auth/login')),
        allowedRoles: jsonArray(endpoint.allowedRoles ?? defaultAllowedRoles(fullPath)),
        containsPii: endpoint.containsPii ?? containsPiiForEndpoint(fullPath),
        piiFields: jsonArray(endpoint.piiFields ?? []),
        riskLevel: endpoint.riskLevel ?? riskLevelForEndpoint(method, fullPath),
        isDestructive: endpoint.isDestructive ?? (method === 'DELETE' || /kill-switch|cancel|apply-retention|decision/i.test(fullPath)),
        isReadonly: endpoint.isReadonly ?? method === 'GET',
        idempotencyRequired: endpoint.idempotencyRequired ?? (method !== 'GET' && method !== 'DELETE'),
        requiresStressTest: endpoint.requiresStressTest ?? false,
        requiresIntegrationTest: endpoint.requiresIntegrationTest ?? true,
        isTestableFromPortal: endpoint.isTestableFromPortal ?? method === 'GET',
        testEnvironmentOnly: endpoint.testEnvironmentOnly ?? true,
        ownerTeam: endpoint.ownerTeam ?? moduleFromPath(fullPath),
        status: endpoint.status ?? 'ACTIVE',
        detectedFrom: endpoint.detectedFrom ?? 'manual_seed',
        confidenceLevel: endpoint.confidenceLevel ?? 'MEDIUM',
        reviewStatus: endpoint.reviewStatus ?? 'AUTO_DETECTED',
        sourceFile: endpoint.sourceFile ?? null,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function upsertDataEntity(queryInterface: QueryInterface, table: DataEntityClassification) {
  await queryInterface.sequelize.query(
    `INSERT INTO system_data_entity_catalog (
      schema_name, table_name, model_name, entity_name, module, business_purpose, data_owner,
      contains_pii, contains_financial_data, contains_risk_data, contains_legal_data, contains_device_data,
      contains_location_data, is_audit_critical, status, detected_from, confidence_level, review_status,
      _created_at, _updated_at
    ) VALUES (
      'public', :tableName, :modelName, :entityName, :module, :businessPurpose, 'systems',
      :containsPii, :containsFinancialData, :containsRiskData, :containsLegalData, :containsDeviceData,
      :containsLocationData, :isAuditCritical, 'ACTIVE', 'model_scan', 'HIGH', 'AUTO_DETECTED',
      :createdAt, :createdAt
    ) ON CONFLICT (schema_name, table_name) DO UPDATE SET
      model_name = EXCLUDED.model_name,
      entity_name = EXCLUDED.entity_name,
      module = EXCLUDED.module,
      business_purpose = EXCLUDED.business_purpose,
      contains_pii = EXCLUDED.contains_pii,
      contains_financial_data = EXCLUDED.contains_financial_data,
      contains_risk_data = EXCLUDED.contains_risk_data,
      contains_legal_data = EXCLUDED.contains_legal_data,
      contains_device_data = EXCLUDED.contains_device_data,
      contains_location_data = EXCLUDED.contains_location_data,
      is_audit_critical = EXCLUDED.is_audit_critical,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        ...table,
        businessPurpose: `Tabla ${table.tableName} (${table.entityName}) usada por el módulo ${table.module}. Clasificada automáticamente para gobierno, QA e impactos de endpoints.`,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function upsertToolRequirement(
  queryInterface: QueryInterface,
  endpoint: EndpointSeed,
  toolCode: string,
  usageType: string,
  options: { isRequired?: boolean; failureImpact?: string; requiresMock?: boolean; requiresStressTest?: boolean; notes?: string } = {},
) {
  await queryInterface.sequelize.query(
    `WITH endpoint AS (
       SELECT _id FROM system_endpoint_catalog WHERE method = :method AND full_path = :fullPath
     ), tool AS (
       SELECT _id FROM system_tool_catalog WHERE code = :toolCode
     )
     INSERT INTO system_endpoint_tool_requirements (
       endpoint_id, tool_id, usage_type, is_required, failure_impact, fallback_strategy,
       requires_mock, requires_stress_test, notes, detected_from, confidence_level, review_status, _created_at, _updated_at
     )
     SELECT endpoint._id, tool._id, :usageType, :isRequired, :failureImpact, :fallbackStrategy,
       :requiresMock, :requiresStressTest, :notes, 'system_seed', 'HIGH', 'APPROVED', :createdAt, :createdAt
     FROM endpoint, tool
     ON CONFLICT (endpoint_id, tool_id, usage_type) DO UPDATE SET
       is_required = EXCLUDED.is_required,
       failure_impact = EXCLUDED.failure_impact,
       fallback_strategy = EXCLUDED.fallback_strategy,
       requires_mock = EXCLUDED.requires_mock,
       requires_stress_test = EXCLUDED.requires_stress_test,
       notes = EXCLUDED.notes,
       review_status = EXCLUDED.review_status,
       _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        method: endpoint.method,
        fullPath: endpoint.fullPath,
        toolCode,
        usageType,
        isRequired: options.isRequired ?? true,
        failureImpact: options.failureImpact ?? 'HIGH',
        fallbackStrategy: options.requiresMock ? 'Usar mock local gobernado y registrar provider_health_logs.' : null,
        requiresMock: options.requiresMock ?? false,
        requiresStressTest: options.requiresStressTest ?? false,
        notes: options.notes ?? null,
        createdAt: CREATED_AT,
      },
    },
  );
}

function toolRequirementsForEndpoint(endpoint: EndpointSeed): Array<[string, string, Parameters<typeof upsertToolRequirement>[4]]> {
  const path = endpoint.fullPath;
  const requirements: Array<[string, string, Parameters<typeof upsertToolRequirement>[4]]> = [
    ['POSTGRES', 'persistence', { failureImpact: path.includes('/health') ? 'CRITICAL' : 'HIGH' }],
    ['SYSTEM_ACTION_LOGS', 'http_audit', { isRequired: true, failureImpact: 'MEDIUM' }],
  ];
  if (path.includes('/auth'))
    requirements.push(['JWT', 'auth', { failureImpact: 'CRITICAL' }], ['ARGON2', 'password_hash', { failureImpact: 'CRITICAL' }]);
  if (endpoint.idempotencyRequired) requirements.push(['IDEMPOTENCY_KEYS_DB', 'idempotency', { failureImpact: 'HIGH' }]);
  if (!endpoint.isReadonly) requirements.push(['OUTBOX_EVENTS_DB', 'eventing', { failureImpact: 'MEDIUM' }]);
  if (path.includes('/external-data')) {
    requirements.push(['SEGIP_CGIP', 'identity_provider', { isRequired: false, requiresMock: true, failureImpact: 'MEDIUM' }]);
    requirements.push(['INFOCENTER', 'credit_bureau', { isRequired: false, requiresMock: true, failureImpact: 'HIGH' }]);
    requirements.push(['QR_GENERIC', 'payment_verification', { isRequired: false, requiresMock: true, failureImpact: 'MEDIUM' }]);
    requirements.push(['BANKING_GENERIC', 'banking_verification', { isRequired: false, requiresMock: true, failureImpact: 'MEDIUM' }]);
    requirements.push(['TELCO_GENERIC', 'phone_trust', { isRequired: false, requiresMock: true, failureImpact: 'LOW' }]);
    requirements.push(['DIGITAL_TRUST_GENERIC', 'digital_trust', { isRequired: false, requiresMock: true, failureImpact: 'LOW' }]);
  }
  if (path.includes('/notifications'))
    requirements.push(['WHATSAPP_GENERIC', 'notification_provider', { isRequired: false, requiresMock: true, failureImpact: 'MEDIUM' }]);
  if (path.includes('/systems/test') || path.includes('/systems/stress')) {
    requirements.push(['SMOKE_SCRIPTS', 'qa_execution', { isRequired: false, failureImpact: 'LOW' }]);
    requirements.push(['JEST', 'qa_reference', { isRequired: false, failureImpact: 'LOW' }]);
  }
  if (path.includes('/queue-run') || path.includes('/jobs'))
    requirements.push(['BULLMQ', 'queue_planned', { isRequired: false, requiresMock: true, failureImpact: 'MEDIUM' }]);
  if (endpoint.requiresStressTest)
    requirements.push([
      'NEST_THROTTLER_REDIS',
      'rate_limit_stress_guard',
      { isRequired: false, failureImpact: 'MEDIUM', requiresStressTest: true },
    ]);
  return requirements;
}

function tablesForEndpoint(
  endpoint: EndpointSeed,
): Array<{ table: string; operation: string; primary?: boolean; level?: string; notes?: string }> {
  const path = endpoint.fullPath;
  const method = endpoint.method;
  const rows: Array<{ table: string; operation: string; primary?: boolean; level?: string; notes?: string }> = [];
  const add = (table: string, operation: string, primary = false, level = 'MEDIUM', notes?: string) =>
    rows.push({ table, operation, primary, level, notes });

  if (!path.includes('/health')) {
    add('system_action_logs', 'INSERT', false, 'MEDIUM', 'Auditoría HTTP enriquecida por endpoint.');
    add('operational_audit_logs', method === 'GET' ? 'READ' : 'INSERT', false, 'MEDIUM', 'Bitácora operativa legacy/complementaria.');
  }
  if (path.includes('/auth')) {
    add('auth_credentials', 'READ', true, 'CRITICAL');
    add('auth_refresh_tokens', method === 'POST' ? 'UPSERT' : 'READ', false, 'CRITICAL');
    add('auth_events', 'INSERT', false, 'HIGH');
    if (path.includes('/internal/')) {
      add('internal_users', 'READ', true, 'CRITICAL');
      add('internal_user_roles', 'READ', false, 'HIGH');
      add('internal_role_permissions', 'READ', false, 'HIGH');
    }
  }
  if (path.includes('/internal/users')) {
    add('internal_users', method === 'GET' ? 'READ' : 'UPDATE', true, 'HIGH');
    add('internal_user_roles', method === 'GET' ? 'READ' : 'UPSERT', false, 'HIGH');
  }
  if (path.includes('/internal/roles') || path.includes('/internal/permissions')) {
    add('internal_roles', 'READ', true, 'HIGH');
    add('internal_permissions', 'READ', false, 'HIGH');
    add('internal_role_permissions', 'READ', false, 'HIGH');
  }
  if (path.includes('/customer-onboarding')) {
    add('customers', 'UPSERT', true, 'CRITICAL');
    add('customer_profile_versions', 'INSERT', false, 'HIGH');
    add('customer_contact_methods', 'UPSERT', false, 'HIGH');
    add('customer_identity_documents', 'UPSERT', false, 'CRITICAL');
    add('customer_address_versions', 'UPSERT', false, 'HIGH');
    add('customer_consents', 'UPSERT', false, 'CRITICAL');
    add('onboarding_flows', 'UPSERT', false, 'HIGH');
    add('onboarding_step_events', 'INSERT', false, 'MEDIUM');
    add('devices', 'UPSERT', false, 'HIGH');
    add('customer_device_links', 'UPSERT', false, 'HIGH');
  }
  if (path.includes('/customers/:customerId/me') || (path.includes('/customers/') && path.includes('/privacy')))
    add('customers', 'READ', true, 'HIGH');
  if (path.includes('/privacy/consent-decisions')) {
    add('customer_consents', 'UPSERT', true, 'CRITICAL');
    add('consent_events', 'INSERT', false, 'HIGH');
  }
  if (path.includes('/privacy/data-subject-requests')) add('data_subject_requests', 'INSERT', true, 'HIGH');
  if (path.includes('/risk-assessments')) {
    add('risk_assessment_runs', method === 'POST' ? 'INSERT' : 'READ', true, 'CRITICAL');
    add('risk_assessment_results', method === 'POST' ? 'INSERT' : 'READ', false, 'CRITICAL');
    add('risk_rules_fired', method === 'POST' ? 'INSERT' : 'READ', false, 'HIGH');
    add('risk_feature_contributions', method === 'POST' ? 'INSERT' : 'READ', false, 'HIGH');
    add('feature_values', 'READ', false, 'HIGH');
    add('risk_policy_rules', 'READ', false, 'HIGH');
    add('manual_review_cases', method === 'POST' ? 'UPSERT' : 'READ', false, 'HIGH');
  }
  if (
    path.includes('/operations/work-queue') ||
    path.includes('/manual-review-cases') ||
    path.includes('/fraud-cases') ||
    path.includes('/investigation-summary')
  ) {
    add('manual_review_cases', path.includes('/decision') ? 'UPDATE' : 'READ', true, 'HIGH');
    add('manual_review_events', path.includes('/decision') ? 'INSERT' : 'READ', false, 'HIGH');
    add('fraud_cases', path.includes('/decision') ? 'UPDATE' : 'READ', false, 'HIGH');
    add('fraud_case_events', path.includes('/decision') ? 'INSERT' : 'READ', false, 'HIGH');
    add('data_quality_issues', 'READ', false, 'MEDIUM');
    add('customer_activity_summaries', 'READ', false, 'MEDIUM');
  }
  if (
    path.includes('/operations/catalog') ||
    path.includes('/operations/definitions') ||
    path.includes('/risk-policy') ||
    path.includes('/data-governance')
  ) {
    const op = method === 'GET' ? 'READ' : 'UPSERT';
    for (const table of [
      'context_catalogs',
      'context_catalog_versions',
      'context_items',
      'context_item_aliases',
      'context_risk_mappings',
      'observation_definitions',
      'attribute_definitions',
      'feature_definitions',
      'event_definitions',
      'risk_ruleset_versions',
      'risk_policy_rules',
      'data_classification_policies',
      'sensitive_field_rules',
      'retention_policies',
    ])
      add(table, op, table === 'context_catalogs', 'HIGH');
  }
  if (path.includes('/external-data')) {
    const op = method === 'GET' ? 'READ' : 'UPSERT';
    for (const table of [
      'data_providers',
      'data_provider_requests',
      'data_provider_responses',
      'provider_health_logs',
      'customer_context_enrichments',
      'feature_values',
      'external_oauth_connections',
    ]) {
      add(table, op, table === 'data_provider_requests', 'HIGH');
    }
  }
  if (path.includes('/notifications')) {
    const op = method === 'GET' ? 'READ' : method === 'DELETE' ? 'UPDATE' : 'UPSERT';
    for (const table of [
      'notification_templates',
      'notification_messages',
      'notification_deliveries',
      'user_notification_preferences',
      'device_tokens',
    ]) {
      add(table, op, table === 'notification_messages' || table === 'notification_templates', 'HIGH');
    }
  }
  if (path.includes('/sessions') || path.includes('/session-state') || path.includes('/telemetry')) {
    const op = method === 'GET' ? 'READ' : 'UPSERT';
    for (const table of [
      'customer_sessions',
      'devices',
      'customer_device_links',
      'device_snapshots',
      'address_gps_observations',
      'sim_observations',
      'ip_reputation_observations',
      'customer_activity_summaries',
    ]) {
      add(table, op, table === 'customer_sessions', 'HIGH');
    }
  }
  if (path.includes('/systems')) {
    const op = method === 'GET' ? 'READ' : method === 'DELETE' ? 'DELETE' : 'UPSERT';
    for (const table of [
      'system_endpoint_catalog',
      'system_data_entity_catalog',
      'system_tool_catalog',
      'system_endpoint_tool_requirements',
      'system_endpoint_data_entity_impacts',
      'system_endpoint_field_impacts',
      'system_test_suites',
      'system_test_steps',
      'system_test_runs',
      'system_stress_profiles',
    ]) {
      add(table, op, table === 'system_endpoint_catalog', 'HIGH');
    }
  }
  if (path.includes('/events') || path.includes('/jobs')) {
    add('outbox_events', method === 'GET' ? 'READ' : 'UPDATE', true, 'HIGH');
    add('system_job_runs', method === 'GET' ? 'READ' : 'INSERT', false, 'HIGH');
  }
  return rows;
}

async function upsertDataImpact(
  queryInterface: QueryInterface,
  endpoint: EndpointSeed,
  impact: ReturnType<typeof tablesForEndpoint>[number],
) {
  await queryInterface.sequelize.query(
    `WITH endpoint AS (
       SELECT _id FROM system_endpoint_catalog WHERE method = :method AND full_path = :fullPath
     ), entity AS (
       SELECT _id FROM system_data_entity_catalog WHERE schema_name = 'public' AND table_name = :tableName
     )
     INSERT INTO system_endpoint_data_entity_impacts (
       endpoint_id, data_entity_id, operation_type, impact_level, is_primary_entity, is_transactional,
       rollback_required, affects_customer_state, affects_financial_state, affects_risk_state, affects_legal_state,
       affects_device_state, affects_notification_state, requires_audit_log, requires_regression_test,
       requires_stress_test, notes, detected_from, confidence_level, review_status, _created_at, _updated_at
     )
     SELECT endpoint._id, entity._id, :operationType, :impactLevel, :isPrimaryEntity, :isTransactional,
       :rollbackRequired, :affectsCustomerState, :affectsFinancialState, :affectsRiskState, :affectsLegalState,
       :affectsDeviceState, :affectsNotificationState, true, true, :requiresStressTest,
       :notes, 'system_seed', 'HIGH', 'APPROVED', :createdAt, :createdAt
     FROM endpoint, entity
     ON CONFLICT (endpoint_id, data_entity_id, operation_type) DO UPDATE SET
       impact_level = EXCLUDED.impact_level,
       is_primary_entity = EXCLUDED.is_primary_entity,
       is_transactional = EXCLUDED.is_transactional,
       rollback_required = EXCLUDED.rollback_required,
       affects_customer_state = EXCLUDED.affects_customer_state,
       affects_financial_state = EXCLUDED.affects_financial_state,
       affects_risk_state = EXCLUDED.affects_risk_state,
       affects_legal_state = EXCLUDED.affects_legal_state,
       affects_device_state = EXCLUDED.affects_device_state,
       affects_notification_state = EXCLUDED.affects_notification_state,
       requires_regression_test = EXCLUDED.requires_regression_test,
       requires_stress_test = EXCLUDED.requires_stress_test,
       notes = EXCLUDED.notes,
       review_status = EXCLUDED.review_status,
       _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        method: endpoint.method,
        fullPath: endpoint.fullPath,
        tableName: impact.table,
        operationType: impact.operation,
        impactLevel: impact.level ?? 'MEDIUM',
        isPrimaryEntity: impact.primary ?? false,
        isTransactional: endpoint.method !== 'GET',
        rollbackRequired: endpoint.method !== 'GET' && endpoint.method !== 'DELETE',
        affectsCustomerState: /customer|identity|contact|consent|session|device|onboarding/.test(impact.table),
        affectsFinancialState: /payment|purchase|installment|credit|settlement|merchant/.test(impact.table),
        affectsRiskState: /risk|feature|fraud|watchlist|provider|quality/.test(impact.table),
        affectsLegalState: /consent|privacy|retention|classification|sensitive|subject/.test(impact.table),
        affectsDeviceState: /device|gps|sim|ip_|session|telemetry/.test(impact.table),
        affectsNotificationState: /notification|device_tokens/.test(impact.table),
        requiresStressTest: endpoint.requiresStressTest ?? false,
        notes: impact.notes ?? `Impacto semilla: ${endpoint.method} ${endpoint.fullPath} usa ${impact.table}.`,
        createdAt: CREATED_AT,
      },
    },
  );
}

const FIELD_IMPACT_SEEDS: Array<{
  pathIncludes: string;
  table: string;
  fields: Array<{
    name: string;
    operation: string;
    required?: boolean;
    generated?: boolean;
    sensitive?: boolean;
    ml?: boolean;
    group?: string;
    notes?: string;
  }>;
}> = [
  {
    pathIncludes: '/auth/login',
    table: 'auth_credentials',
    fields: [
      { name: 'credential_key', operation: 'READ', required: true, sensitive: true, notes: 'Email/usuario normalizado para lookup.' },
      { name: 'password_hash', operation: 'READ', sensitive: true, notes: 'Hash Argon2, nunca se expone.' },
    ],
  },
  {
    pathIncludes: '/customer-onboarding',
    table: 'customers',
    fields: [
      { name: 'primary_phone_hash', operation: 'HASH', required: true, sensitive: true, ml: true, group: 'contactability' },
      { name: 'email_hash', operation: 'HASH', sensitive: true, ml: true, group: 'contactability' },
      { name: 'status', operation: 'WRITE', generated: true, ml: true, group: 'lifecycle' },
    ],
  },
  {
    pathIncludes: '/risk-assessments',
    table: 'risk_assessment_results',
    fields: [
      { name: 'score_total', operation: 'COMPUTE', generated: true, ml: true, group: 'credit_score' },
      { name: 'risk_band', operation: 'COMPUTE', generated: true, ml: true, group: 'risk_band' },
      { name: 'reason_codes_json', operation: 'WRITE', generated: true, ml: true, group: 'explainability' },
    ],
  },
  {
    pathIncludes: '/external-data',
    table: 'data_provider_requests',
    fields: [
      { name: 'provider_id', operation: 'WRITE', required: true, ml: true, group: 'external_provider_usage' },
      { name: 'purpose_code', operation: 'WRITE', required: true, sensitive: false, group: 'privacy_governance' },
      { name: 'request_payload_hash', operation: 'HASH', sensitive: true, group: 'provider_request' },
    ],
  },
  {
    pathIncludes: '/systems/endpoints',
    table: 'system_endpoint_catalog',
    fields: [
      { name: 'full_path', operation: 'WRITE', required: true, group: 'endpoint_catalog' },
      { name: 'business_purpose', operation: 'WRITE', required: true, group: 'endpoint_catalog' },
      { name: 'risk_level', operation: 'WRITE', required: true, group: 'endpoint_catalog' },
    ],
  },
  {
    pathIncludes: '/notifications',
    table: 'notification_messages',
    fields: [
      { name: 'recipient_id', operation: 'WRITE', required: true, sensitive: true, group: 'notification_target' },
      { name: 'body', operation: 'WRITE', required: true, sensitive: false, group: 'message_content' },
      { name: 'delivery_targets_json', operation: 'ENCRYPT', sensitive: true, group: 'delivery' },
    ],
  },
  {
    pathIncludes: '/sessions',
    table: 'customer_sessions',
    fields: [
      { name: 'session_token_hash', operation: 'HASH', generated: true, sensitive: true, group: 'session_security' },
      { name: 'status', operation: 'WRITE', generated: true, ml: true, group: 'behavior' },
      { name: 'last_seen_at', operation: 'WRITE', generated: true, ml: true, group: 'behavior' },
    ],
  },
];

async function upsertFieldImpact(
  queryInterface: QueryInterface,
  endpoint: EndpointSeed,
  seed: (typeof FIELD_IMPACT_SEEDS)[number],
  field: (typeof FIELD_IMPACT_SEEDS)[number]['fields'][number],
) {
  await queryInterface.sequelize.query(
    `WITH endpoint AS (
       SELECT _id FROM system_endpoint_catalog WHERE method = :method AND full_path = :fullPath
     ), entity AS (
       SELECT _id FROM system_data_entity_catalog WHERE schema_name = 'public' AND table_name = :tableName
     )
     INSERT INTO system_endpoint_field_impacts (
       endpoint_id, data_entity_id, field_name, field_operation, is_required_input, is_generated,
       is_sensitive, is_ml_candidate, ml_feature_group, validation_rule, notes, confidence_level,
       review_status, _created_at, _updated_at
     )
     SELECT endpoint._id, entity._id, :fieldName, :fieldOperation, :isRequiredInput, :isGenerated,
       :isSensitive, :isMlCandidate, :mlFeatureGroup, CAST(:validationRule AS jsonb), :notes, 'HIGH',
       'APPROVED', :createdAt, :createdAt
     FROM endpoint, entity
     ON CONFLICT (endpoint_id, data_entity_id, field_name, field_operation) DO UPDATE SET
       is_required_input = EXCLUDED.is_required_input,
       is_generated = EXCLUDED.is_generated,
       is_sensitive = EXCLUDED.is_sensitive,
       is_ml_candidate = EXCLUDED.is_ml_candidate,
       ml_feature_group = EXCLUDED.ml_feature_group,
       validation_rule = EXCLUDED.validation_rule,
       notes = EXCLUDED.notes,
       review_status = EXCLUDED.review_status,
       _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        method: endpoint.method,
        fullPath: endpoint.fullPath,
        tableName: seed.table,
        fieldName: field.name,
        fieldOperation: field.operation,
        isRequiredInput: field.required ?? false,
        isGenerated: field.generated ?? false,
        isSensitive: field.sensitive ?? false,
        isMlCandidate: field.ml ?? false,
        mlFeatureGroup: field.group ?? null,
        validationRule: json({ source: 'system_seed', rule: field.required ? 'required_for_endpoint' : 'optional_or_generated' }),
        notes: field.notes ?? `Campo ${field.name} documentado para ${endpoint.method} ${endpoint.fullPath}.`,
        createdAt: CREATED_AT,
      },
    },
  );
}

const TEST_SUITES: TestSuiteSeed[] = [
  {
    code: 'SMOKE_CORE_READINESS',
    name: 'Smoke base del backend',
    description: 'Valida que el backend, catálogos y cliente demo estén listos para arrancar pruebas manuales del portal.',
    module: 'core',
    suiteType: 'SMOKE',
    isSafeForProduction: true,
    steps: [
      { name: 'Health', method: 'GET', pathTemplate: '/api/v1/health', assertions: { statusIn: [200] } },
      {
        name: 'Consentimientos activos',
        method: 'GET',
        pathTemplate: '/api/v1/consent-documents/active?language=es',
        assertions: { statusIn: [200] },
      },
      { name: 'Cliente demo', method: 'GET', pathTemplate: '/api/v1/customers/1/me', assertions: { statusIn: [200] } },
    ],
  },
  {
    code: 'PORTAL_ADMIN_SYSTEMS_READINESS',
    name: 'Portal administrativo de sistemas',
    description: 'Cubre las vistas base: dashboard, endpoints, herramientas, entidades, review queue, suites y perfiles de stress.',
    module: 'systems',
    suiteType: 'REGRESSION',
    steps: [
      { name: 'Dashboard sistemas', method: 'GET', pathTemplate: '/api/v1/systems/dashboard', assertions: { statusIn: [200] } },
      {
        name: 'Catálogo endpoints',
        method: 'GET',
        pathTemplate: '/api/v1/systems/endpoints?page=1&limit=20',
        assertions: { statusIn: [200] },
      },
      {
        name: 'Catálogo entidades',
        method: 'GET',
        pathTemplate: '/api/v1/systems/data-entities?page=1&limit=20',
        assertions: { statusIn: [200] },
      },
      {
        name: 'Catálogo herramientas',
        method: 'GET',
        pathTemplate: '/api/v1/systems/tools?page=1&limit=20',
        assertions: { statusIn: [200] },
      },
      { name: 'Cola de revisión', method: 'GET', pathTemplate: '/api/v1/systems/review-queue', assertions: { statusIn: [200] } },
      { name: 'Suites de prueba', method: 'GET', pathTemplate: '/api/v1/systems/test-suites', assertions: { statusIn: [200] } },
      { name: 'Perfiles stress', method: 'GET', pathTemplate: '/api/v1/systems/stress-profiles', assertions: { statusIn: [200] } },
    ],
  },
  {
    code: 'OPERATIONS_WORK_QUEUE_READINESS',
    name: 'Operaciones y casos demo',
    description: 'Valida cola operativa, revisión manual, fraude, auditoría y calidad de datos con registros semilla.',
    module: 'operations',
    suiteType: 'REGRESSION',
    steps: [
      {
        name: 'Work queue',
        method: 'GET',
        pathTemplate: '/api/v1/operations/work-queue?queue=all&page=1&limit=20',
        assertions: { statusIn: [200] },
      },
      {
        name: 'Casos manuales',
        method: 'GET',
        pathTemplate: '/api/v1/operations/manual-review-cases?limit=20',
        assertions: { statusIn: [200] },
      },
      { name: 'Casos fraude', method: 'GET', pathTemplate: '/api/v1/operations/fraud-cases?limit=20', assertions: { statusIn: [200] } },
      {
        name: 'Resumen investigación',
        method: 'GET',
        pathTemplate: '/api/v1/operations/customers/1/investigation-summary',
        assertions: { statusIn: [200] },
      },
      {
        name: 'Calidad de datos',
        method: 'GET',
        pathTemplate: '/api/v1/operations/data-quality/issues?page=1&limit=20',
        assertions: { statusIn: [200] },
      },
    ],
  },
  {
    code: 'CATALOG_RISK_GOVERNANCE_READINESS',
    name: 'Catálogos, riesgo y gobierno',
    description: 'Valida que existan catálogos, definiciones, políticas de riesgo y políticas de gobierno para poblar el portal.',
    module: 'catalog_management',
    suiteType: 'REGRESSION',
    steps: [
      { name: 'Catálogos', method: 'GET', pathTemplate: '/api/v1/operations/catalogs', assertions: { statusIn: [200] } },
      {
        name: 'Definiciones',
        method: 'GET',
        pathTemplate: '/api/v1/operations/definitions?type=all&status=all',
        assertions: { statusIn: [200] },
      },
      { name: 'Risk policy', method: 'GET', pathTemplate: '/api/v1/operations/risk-policy/current', assertions: { statusIn: [200] } },
      {
        name: 'Gobierno datos',
        method: 'GET',
        pathTemplate: '/api/v1/operations/data-governance/policies',
        assertions: { statusIn: [200] },
      },
    ],
  },
  {
    code: 'EXTERNAL_PROVIDERS_READINESS',
    name: 'Proveedores externos y mocks',
    description: 'Valida proveedores Bolivia/mock, health, readiness y auditorías de idempotencia/retención/sanitización.',
    module: 'external_data',
    suiteType: 'INTEGRATION',
    steps: [
      { name: 'Lista proveedores', method: 'GET', pathTemplate: '/api/v1/external-data', assertions: { statusIn: [200] } },
      {
        name: 'Health proveedores',
        method: 'GET',
        pathTemplate: '/api/v1/external-data/providers/health',
        assertions: { statusIn: [200] },
      },
      { name: 'Readiness', method: 'GET', pathTemplate: '/api/v1/external-data/readiness', assertions: { statusIn: [200] } },
      { name: 'Quality audit', method: 'GET', pathTemplate: '/api/v1/external-data/quality-audit', assertions: { statusIn: [200] } },
    ],
  },
  {
    code: 'NOTIFICATIONS_READINESS',
    name: 'Notificaciones operaciones/cliente',
    description: 'Valida plantillas, mensajes y preferencias con datos semilla.',
    module: 'notifications',
    suiteType: 'REGRESSION',
    steps: [
      { name: 'Plantillas', method: 'GET', pathTemplate: '/api/v1/operations/notifications/templates', assertions: { statusIn: [200] } },
      {
        name: 'Mensajes',
        method: 'GET',
        pathTemplate: '/api/v1/operations/notifications/messages?page=1&limit=20',
        assertions: { statusIn: [200] },
      },
      {
        name: 'Preferencias cliente',
        method: 'GET',
        pathTemplate: '/api/v1/operations/notifications/preferences/1',
        assertions: { statusIn: [200] },
      },
      { name: 'Notificaciones cliente', method: 'GET', pathTemplate: '/api/v1/customers/1/notifications', assertions: { statusIn: [200] } },
    ],
  },
];

async function upsertTestSuite(queryInterface: QueryInterface, suite: TestSuiteSeed) {
  await queryInterface.sequelize.query(
    `INSERT INTO system_test_suites (
      code, name, description, module, suite_type, execution_mode, environment_scope,
      is_enabled, requires_seed_data, is_safe_for_production, requires_destructive_permission,
      created_by, _created_at, _updated_at
    ) VALUES (
      :code, :name, :description, :module, :suiteType, 'SYNC_OR_JOB', CAST(:environmentScope AS jsonb),
      true, true, :isSafeForProduction, :requiresDestructivePermission, 'system_seed', :createdAt, :createdAt
    ) ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      module = EXCLUDED.module,
      suite_type = EXCLUDED.suite_type,
      environment_scope = EXCLUDED.environment_scope,
      is_enabled = EXCLUDED.is_enabled,
      requires_seed_data = EXCLUDED.requires_seed_data,
      is_safe_for_production = EXCLUDED.is_safe_for_production,
      requires_destructive_permission = EXCLUDED.requires_destructive_permission,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        code: suite.code,
        name: suite.name,
        description: suite.description,
        module: suite.module,
        suiteType: suite.suiteType,
        environmentScope: jsonArray(suite.isSafeForProduction ? ['LOCAL', 'STAGING', 'PRODUCTION_READONLY'] : ['LOCAL', 'STAGING']),
        isSafeForProduction: suite.isSafeForProduction ?? false,
        requiresDestructivePermission: suite.requiresDestructivePermission ?? false,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function upsertTestStep(queryInterface: QueryInterface, suiteCode: string, step: TestStepSeed, order: number) {
  await queryInterface.sequelize.query(
    `WITH suite AS (
       SELECT _id FROM system_test_suites WHERE code = :suiteCode
     ), endpoint AS (
       SELECT _id FROM system_endpoint_catalog WHERE method = :method AND full_path = :endpointPath
     )
     INSERT INTO system_test_steps (
       suite_id, endpoint_id, step_order, name, input_mode, method, path_template,
       default_headers, default_payload, config_schema, extractors, assertions,
       continue_on_failure, cleanup_required, _created_at, _updated_at
     )
     SELECT suite._id, endpoint._id, :stepOrder, :name, :inputMode, :method, :pathTemplate,
       CAST(:defaultHeaders AS jsonb), CAST(:defaultPayload AS jsonb), CAST(:configSchema AS jsonb), CAST(:extractors AS jsonb), CAST(:assertions AS jsonb),
       :continueOnFailure, :cleanupRequired, :createdAt, :createdAt
     FROM suite LEFT JOIN endpoint ON true
     ON CONFLICT (suite_id, step_order) DO UPDATE SET
       endpoint_id = EXCLUDED.endpoint_id,
       name = EXCLUDED.name,
       input_mode = EXCLUDED.input_mode,
       method = EXCLUDED.method,
       path_template = EXCLUDED.path_template,
       default_headers = EXCLUDED.default_headers,
       default_payload = EXCLUDED.default_payload,
       config_schema = EXCLUDED.config_schema,
       extractors = EXCLUDED.extractors,
       assertions = EXCLUDED.assertions,
       continue_on_failure = EXCLUDED.continue_on_failure,
       cleanup_required = EXCLUDED.cleanup_required,
       _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        suiteCode,
        method: step.method,
        endpointPath: step.pathTemplate.split('?')[0],
        pathTemplate: step.pathTemplate,
        stepOrder: order,
        name: step.name,
        inputMode: step.inputMode ?? 'DEFAULT',
        defaultHeaders: json(step.defaultHeaders ?? { authorization: 'Bearer {{accessToken}}', 'x-tenant-id': '1' }),
        defaultPayload: json(step.defaultPayload ?? {}),
        configSchema: json(step.configSchema ?? {}),
        extractors: json(step.extractors ?? {}),
        assertions: json(step.assertions ?? { statusIn: [200, 201, 204] }),
        continueOnFailure: step.continueOnFailure ?? false,
        cleanupRequired: step.cleanupRequired ?? false,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function upsertStressProfile(queryInterface: QueryInterface, profile: (typeof STRESS_PROFILE_SEEDS)[number]) {
  await queryInterface.sequelize.query(
    `WITH endpoint AS (
       SELECT _id FROM system_endpoint_catalog WHERE method = :method AND full_path = :path
     )
     INSERT INTO system_stress_profiles (
       endpoint_id, code, name, target_rps, duration_seconds, concurrency, environment_scope,
       max_error_rate, max_p95_ms, is_enabled, requires_approval, status, notes, created_by, updated_by, _created_at, _updated_at
     )
     SELECT endpoint._id, :code, :name, :targetRps, :durationSeconds, :concurrency, CAST(:environmentScope AS jsonb),
       :maxErrorRate, :maxP95Ms, true, true, 'ACTIVE', :notes, 'system_seed', 'system_seed', :createdAt, :createdAt
     FROM endpoint
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       target_rps = EXCLUDED.target_rps,
       duration_seconds = EXCLUDED.duration_seconds,
       concurrency = EXCLUDED.concurrency,
       environment_scope = EXCLUDED.environment_scope,
       max_error_rate = EXCLUDED.max_error_rate,
       max_p95_ms = EXCLUDED.max_p95_ms,
       is_enabled = EXCLUDED.is_enabled,
       requires_approval = EXCLUDED.requires_approval,
       status = EXCLUDED.status,
       notes = EXCLUDED.notes,
       updated_by = 'system_seed',
       _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        method: profile.method,
        path: profile.path,
        code: buildEndpointCode(profile.method, profile.path).replace(/^GET_|^POST_|^PATCH_|^DELETE_/, 'STRESS_'),
        name: profile.name,
        targetRps: profile.targetRps,
        durationSeconds: profile.durationSeconds,
        concurrency: profile.concurrency,
        environmentScope: jsonArray(['LOCAL', 'STAGING']),
        maxErrorRate: profile.maxErrorRate ?? 0.02,
        maxP95Ms: profile.maxP95Ms ?? 1200,
        notes: 'Perfil semilla seguro; requiere aprobación antes de ejecutar carga real.',
        createdAt: CREATED_AT,
      },
    },
  );
}

async function seedDataEntities(queryInterface: QueryInterface): Promise<void> {
  const modelDir = join(process.cwd(), 'src', 'database', 'models');
  if (!existsSync(modelDir)) return;
  const seen = new Set<string>();
  for (const file of readdirSync(modelDir)
    .filter((name) => name.endsWith('.model.ts'))
    .sort()) {
    const source = readFileSync(join(modelDir, file), 'utf8');
    const tableName = source.match(/@Table\(\{\s*tableName:\s*['"]([^'"]+)['"]/s)?.[1];
    const modelName = source.match(/export\s+class\s+([A-Za-z0-9_]+)/)?.[1] ?? null;
    if (!tableName || seen.has(tableName)) continue;
    seen.add(tableName);
    await upsertDataEntity(queryInterface, classifyTable(tableName, modelName));
  }
}

export async function up({ context: queryInterface }: SeedContext): Promise<void> {
  const endpoints = mergedEndpoints();
  for (const tool of SYSTEM_TOOL_SEEDS) await upsertTool(queryInterface, tool);
  for (const endpoint of endpoints) await upsertEndpoint(queryInterface, endpoint);
  await seedDataEntities(queryInterface);

  for (const endpoint of endpoints) {
    for (const [toolCode, usageType, options] of toolRequirementsForEndpoint(endpoint)) {
      await upsertToolRequirement(queryInterface, endpoint, toolCode, usageType, options);
    }
    for (const impact of tablesForEndpoint(endpoint)) await upsertDataImpact(queryInterface, endpoint, impact);
    for (const seed of FIELD_IMPACT_SEEDS.filter((item) => endpoint.fullPath.includes(item.pathIncludes))) {
      for (const field of seed.fields) await upsertFieldImpact(queryInterface, endpoint, seed, field);
    }
  }

  for (const suite of TEST_SUITES) {
    await upsertTestSuite(queryInterface, suite);
    for (const [index, step] of suite.steps.entries()) await upsertTestStep(queryInterface, suite.code, step, index + 1);
  }

  for (const profile of STRESS_PROFILE_SEEDS) await upsertStressProfile(queryInterface, profile);
}

export async function down({ context: queryInterface }: SeedContext): Promise<void> {
  await queryInterface.sequelize.query(
    `DELETE FROM system_test_steps WHERE suite_id IN (SELECT _id FROM system_test_suites WHERE created_by = 'system_seed');`,
  );
  await queryInterface.sequelize.query(`DELETE FROM system_test_suites WHERE created_by = 'system_seed';`);
  await queryInterface.sequelize.query(`DELETE FROM system_stress_profiles WHERE created_by = 'system_seed';`);
  await queryInterface.sequelize.query(`DELETE FROM system_endpoint_tool_requirements WHERE detected_from = 'system_seed';`);
  await queryInterface.sequelize.query(
    `DELETE FROM system_endpoint_field_impacts WHERE review_status = 'APPROVED' AND notes LIKE '%documentado para%';`,
  );
  await queryInterface.sequelize.query(`DELETE FROM system_endpoint_data_entity_impacts WHERE detected_from = 'system_seed';`);
  await queryInterface.sequelize.query(`DELETE FROM system_endpoint_catalog WHERE created_by = 'system_seed';`);
  await queryInterface.sequelize.query(`DELETE FROM system_tool_catalog WHERE code IN (:codes);`, {
    replacements: { codes: SYSTEM_TOOL_SEEDS.map((tool) => tool.code) },
  });
}
