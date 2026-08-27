/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { InternalRoleCode } from './internal-rbac.roles.js';

export type InternalPermissionSeed = {
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiresReason: boolean;
};

/*
 * Cada permiso se declara con los campos nombrados.
 *
 * La forma anterior era posicional y compacta, que para una tabla se lee bien hasta las dos
 * últimas columnas: `riskLevel` y `requiresReason` son opcionales, van al final y son
 * precisamente los dos CONTROLES —el nivel de riesgo y la exigencia de motivo escrito—. Un
 * permiso al que se le olvida el `true` final no falla en ninguna parte: simplemente deja de
 * pedir justificación, y eso no se descubre leyendo la fila.
 */
function permission(entrada: {
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string;
  riskLevel?: InternalPermissionSeed['riskLevel'];
  requiresReason?: boolean;
}): InternalPermissionSeed {
  return {
    code: entrada.code,
    module: entrada.module,
    resource: entrada.resource,
    action: entrada.action,
    description: entrada.description,
    riskLevel: entrada.riskLevel ?? 'MEDIUM',
    requiresReason: entrada.requiresReason ?? false,
  };
}

export const INTERNAL_PERMISSION_SEEDS: readonly InternalPermissionSeed[] = [
  permission({
    code: 'auth.internal.me.read',
    module: 'auth',
    resource: 'internal_session',
    action: 'read',
    description: 'Consultar perfil, roles y permisos efectivos propios.',
    riskLevel: 'LOW',
  }),
  permission({
    code: 'systems.dashboard.read',
    module: 'systems',
    resource: 'dashboard',
    action: 'read',
    description: 'Consultar dashboard técnico del portal interno.',
  }),
  permission({
    code: 'systems.endpoints.read',
    module: 'systems',
    resource: 'endpoint_catalog',
    action: 'read',
    description: 'Consultar catálogo de endpoints.',
  }),
  permission({
    code: 'systems.endpoints.execute',
    module: 'systems',
    resource: 'endpoint_catalog',
    action: 'execute',
    description: 'Ejecutar endpoint controlado desde QA.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'systems.endpoints.discover',
    module: 'systems',
    resource: 'endpoint_catalog',
    action: 'discover',
    description: 'Descubrir endpoints y actualizar revisión.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'systems.endpoints.catalogSeedRefresh',
    module: 'systems',
    resource: 'endpoint_catalog',
    action: 'seed_refresh',
    description: 'Refrescar catálogo técnico desde seed.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'systems.dataEntities.read',
    module: 'systems',
    resource: 'data_entity',
    action: 'read',
    description: 'Consultar entidades y tablas catalogadas.',
  }),
  permission({
    code: 'systems.dataEntities.updateMetadata',
    module: 'systems',
    resource: 'data_entity',
    action: 'update_metadata',
    description: 'Actualizar metadata técnica.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'systems.reviewQueue.read',
    module: 'systems',
    resource: 'review_queue',
    action: 'read',
    description: 'Consultar cola de revisión.',
  }),
  permission({
    code: 'systems.reviewQueue.resolve',
    module: 'systems',
    resource: 'review_queue',
    action: 'resolve',
    description: 'Resolver elementos de revisión.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'systems.tools.read',
    module: 'systems',
    resource: 'tool_catalog',
    action: 'read',
    description: 'Consultar herramientas internas.',
  }),
  permission({
    code: 'systems.network.read',
    module: 'systems',
    resource: 'network_health',
    action: 'read',
    description: 'Consultar la salud de la RED de bloques del ecosistema.',
  }),
  permission({
    code: 'systems.network.federate',
    module: 'systems',
    resource: 'block_catalog',
    action: 'federate',
    description: 'Refederar el catálogo de un bloque del ecosistema.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'systems.decisionEngine.artifacts.read',
    module: 'systems',
    resource: 'decision_artifact',
    action: 'read',
    description: 'Consultar los artefactos ACTIVOS del motor de decisión.',
  }),
  permission({
    code: 'systems.tools.health.read',
    module: 'systems',
    resource: 'tool_health',
    action: 'read',
    description: 'Consultar salud de herramientas internas.',
  }),
  permission({
    code: 'systems.tools.inferRequirements',
    module: 'systems',
    resource: 'tool_requirements',
    action: 'infer',
    description: 'Inferir requisitos de herramientas.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'systems.qa.read',
    module: 'systems',
    resource: 'qa_suite',
    action: 'read',
    description: 'Consultar suites y corridas QA.',
  }),
  permission({
    code: 'systems.qa.execute',
    module: 'systems',
    resource: 'qa_run',
    action: 'execute',
    description: 'Ejecutar suites QA controladas.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'systems.stress.read',
    module: 'systems',
    resource: 'stress_profile',
    action: 'read',
    description: 'Consultar perfiles y corridas stress.',
  }),
  permission({
    code: 'systems.stress.execute',
    module: 'systems',
    resource: 'stress_run',
    action: 'execute',
    description: 'Ejecutar stress controlado.',
    riskLevel: 'CRITICAL',
    requiresReason: true,
  }),
  permission({
    code: 'internal.users.read',
    module: 'internal',
    resource: 'internal_user',
    action: 'read',
    description: 'Consultar usuarios internos.',
  }),
  permission({
    code: 'merchant.users.read',
    module: 'merchant',
    resource: 'merchant_user',
    action: 'read',
    description: 'Consultar identidades de usuarios de comercios afiliados.',
  }),
  permission({
    code: 'merchant.users.manage',
    module: 'merchant',
    resource: 'merchant_user',
    action: 'manage',
    description: 'Dar de alta, activar, suspender y dar de baja el acceso de usuarios de comercios afiliados.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'internal.users.manage',
    module: 'internal',
    resource: 'internal_user',
    action: 'manage',
    description: 'Crear, editar, suspender y gestionar usuarios internos.',
    riskLevel: 'CRITICAL',
    requiresReason: true,
  }),
  permission({
    code: 'internal.roles.read',
    module: 'internal',
    resource: 'internal_role',
    action: 'read',
    description: 'Consultar roles internos.',
  }),
  permission({
    code: 'internal.roles.manage',
    module: 'internal',
    resource: 'internal_role',
    action: 'manage',
    description: 'Administrar roles internos.',
    riskLevel: 'CRITICAL',
    requiresReason: true,
  }),
  permission({
    code: 'internal.permissions.read',
    module: 'internal',
    resource: 'internal_permission',
    action: 'read',
    description: 'Consultar permisos internos.',
  }),
  permission({
    code: 'catalog.data.read',
    module: 'catalog',
    resource: 'data_catalog',
    action: 'read',
    description: 'Consultar catálogo de datos.',
  }),
  permission({
    code: 'catalog.data.manage',
    module: 'catalog',
    resource: 'data_catalog',
    action: 'manage',
    description: 'Administrar catálogo de datos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'businessMetadata.read',
    module: 'business_metadata',
    resource: 'business_term',
    action: 'read',
    description: 'Consultar metadata de negocio.',
  }),
  permission({
    code: 'businessMetadata.manage',
    module: 'business_metadata',
    resource: 'business_term',
    action: 'manage',
    description: 'Administrar metadata de negocio.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'governance.data.read',
    module: 'governance',
    resource: 'data_governance',
    action: 'read',
    description: 'Consultar gobierno de datos.',
  }),
  permission({
    code: 'governance.data.manage',
    module: 'governance',
    resource: 'data_governance',
    action: 'manage',
    description: 'Administrar gobierno de datos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'governance.policies.read',
    module: 'governance',
    resource: 'policy',
    action: 'read',
    description: 'Consultar políticas de gobierno.',
  }),
  permission({
    code: 'governance.policies.manage',
    module: 'governance',
    resource: 'policy',
    action: 'manage',
    description: 'Administrar políticas de gobierno.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'dataQuality.issues.read',
    module: 'data_quality',
    resource: 'quality_issue',
    action: 'read',
    description: 'Consultar incidencias de calidad.',
  }),
  permission({
    code: 'dataQuality.issues.resolve',
    module: 'data_quality',
    resource: 'quality_issue',
    action: 'resolve',
    description: 'Resolver incidencias de calidad.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'dataQuality.rules.read',
    module: 'data_quality',
    resource: 'quality_rule',
    action: 'read',
    description: 'Consultar reglas de calidad.',
  }),
  permission({
    code: 'dataQuality.rules.manage',
    module: 'data_quality',
    resource: 'quality_rule',
    action: 'manage',
    description: 'Administrar reglas de calidad.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'operations.catalogs.read',
    module: 'operations',
    resource: 'catalog',
    action: 'read',
    description: 'Consultar catálogos operativos.',
  }),
  permission({
    code: 'operations.definitions.read',
    module: 'operations',
    resource: 'definition',
    action: 'read',
    description: 'Consultar definiciones operativas.',
  }),
  permission({
    code: 'operations.riskPolicy.read',
    module: 'operations',
    resource: 'risk_policy',
    action: 'read',
    description: 'Consultar política de riesgo vigente.',
  }),
  permission({
    code: 'reporting.read',
    module: 'reporting',
    resource: 'report',
    action: 'read',
    description: 'Consultar reportes dinámicos.',
  }),
  permission({
    code: 'reporting.execute',
    module: 'reporting',
    resource: 'report',
    action: 'execute',
    description: 'Ejecutar reportes dinámicos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'reporting.manage',
    module: 'reporting',
    resource: 'report',
    action: 'manage',
    description: 'Administrar reportes dinámicos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'lineage.read',
    module: 'lineage',
    resource: 'lineage_graph',
    action: 'read',
    description: 'Consultar lineage e impacto.',
  }),
  permission({
    code: 'audit.events.read',
    module: 'audit',
    resource: 'audit_event',
    action: 'read',
    description: 'Consultar eventos de auditoría.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'audit.events.detail',
    module: 'audit',
    resource: 'audit_event',
    action: 'detail',
    description: 'Consultar detalle de auditoría sensible.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'notifications.messages.read',
    module: 'notifications',
    resource: 'notification_message',
    action: 'read',
    description: 'Consultar mensajes de notificación (in-app/push/email/sms/whatsapp) y su historial de entrega.',
  }),
  permission({
    code: 'notifications.messages.manage',
    module: 'notifications',
    resource: 'notification_message',
    action: 'manage',
    description: 'Reintentar o cancelar mensajes de notificación pendientes/fallidos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'notifications.templates.read',
    module: 'notifications',
    resource: 'notification_template',
    action: 'read',
    description: 'Consultar plantillas de notificación.',
  }),
  permission({
    code: 'notifications.templates.manage',
    module: 'notifications',
    resource: 'notification_template',
    action: 'manage',
    description: 'Crear y editar plantillas de notificación.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
];

const codeStartsWith = (prefix: string): string[] =>
  INTERNAL_PERMISSION_SEEDS.filter((item) => item.code.startsWith(prefix)).map((item) => item.code);
const allReadPermissions = INTERNAL_PERMISSION_SEEDS.filter((item) => item.action === 'read' || item.action === 'detail').map(
  (item) => item.code,
);
const systemsAdminPermissions = [
  'auth.internal.me.read',
  ...codeStartsWith('systems.'),
  ...codeStartsWith('internal.'),
  ...codeStartsWith('catalog.'),
  ...codeStartsWith('businessMetadata.'),
  ...codeStartsWith('governance.'),
  ...codeStartsWith('dataQuality.'),
  ...codeStartsWith('reporting.'),
  ...codeStartsWith('notifications.'),
  'lineage.read',
  'audit.events.read',
  'audit.events.detail',
];

export const ROLE_PERMISSION_CODES: Readonly<Record<InternalRoleCode, readonly string[]>> = {
  SUPER_ADMIN: INTERNAL_PERMISSION_SEEDS.map((item) => item.code),
  SYSTEMS_ADMIN: systemsAdminPermissions,
  INTERNAL_IDENTITY_ADMIN: [
    'auth.internal.me.read',
    'internal.users.read',
    'internal.users.manage',
    'internal.roles.read',
    'internal.roles.manage',
    'internal.permissions.read',
    'audit.events.read',
    'audit.events.detail',
  ],
  OPERATIONS_MANAGER: [
    'auth.internal.me.read',
    'systems.dashboard.read',
    'operations.catalogs.read',
    'operations.definitions.read',
    'operations.riskPolicy.read',
    'catalog.data.read',
    'reporting.read',
    'notifications.messages.read',
    'notifications.templates.read',
  ],
  OPERATIONS_ANALYST: ['auth.internal.me.read', 'operations.catalogs.read', 'operations.definitions.read', 'catalog.data.read'],
  RISK_MANAGER: ['auth.internal.me.read', 'operations.riskPolicy.read', 'catalog.data.read', 'reporting.read', 'audit.events.read'],
  RISK_ANALYST: ['auth.internal.me.read', 'operations.riskPolicy.read', 'catalog.data.read'],
  FRAUD_ANALYST: ['auth.internal.me.read', 'operations.catalogs.read', 'catalog.data.read', 'audit.events.read'],
  COMPLIANCE_MANAGER: [
    'auth.internal.me.read',
    'governance.data.read',
    'governance.policies.read',
    'audit.events.read',
    'audit.events.detail',
    'reporting.read',
  ],
  COMPLIANCE_ANALYST: ['auth.internal.me.read', 'governance.data.read', 'governance.policies.read', 'audit.events.read'],
  COLLECTIONS_MANAGER: ['auth.internal.me.read', 'operations.catalogs.read', 'operations.definitions.read', 'reporting.read'],
  COLLECTIONS_AGENT: ['auth.internal.me.read', 'operations.catalogs.read', 'operations.definitions.read'],
  FINANCE_MANAGER: ['auth.internal.me.read', 'reporting.read', 'reporting.execute', 'audit.events.read'],
  MERCHANT_OPERATIONS: [
    'auth.internal.me.read',
    'operations.catalogs.read',
    'operations.definitions.read',
    // Alta y ciclo de vida de las identidades del comercio: es la contraparte de identidad del
    // onboarding que este rol ya hace. Antes no existía la población, y el ERP terminaba
    // fabricando el rol de comercio a partir de ESTE rol interno.
    'merchant.users.read',
    'merchant.users.manage',
  ],
  DATA_GOVERNANCE_MANAGER: [
    'auth.internal.me.read',
    ...codeStartsWith('catalog.'),
    ...codeStartsWith('businessMetadata.'),
    ...codeStartsWith('governance.'),
    ...codeStartsWith('dataQuality.'),
    'systems.dataEntities.read',
    'systems.dataEntities.updateMetadata',
    'lineage.read',
    'audit.events.read',
  ],
  DATA_QUALITY_ANALYST: [
    'auth.internal.me.read',
    'catalog.data.read',
    'dataQuality.issues.read',
    'dataQuality.issues.resolve',
    'dataQuality.rules.read',
    'dataQuality.rules.manage',
  ],
  QA_ENGINEER: [
    'auth.internal.me.read',
    'systems.endpoints.read',
    'systems.endpoints.execute',
    'systems.qa.read',
    'systems.qa.execute',
    'systems.stress.read',
    'catalog.data.read',
  ],
  AUDITOR_READONLY: ['auth.internal.me.read', ...allReadPermissions],
  SUPPORT_AGENT: ['auth.internal.me.read', 'operations.catalogs.read', 'operations.definitions.read'],
  EXECUTIVE_READONLY: ['auth.internal.me.read', 'systems.dashboard.read', 'reporting.read', 'catalog.data.read'],
};
