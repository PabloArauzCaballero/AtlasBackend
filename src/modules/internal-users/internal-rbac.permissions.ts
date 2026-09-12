/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { InternalRoleCode } from './internal-rbac.roles.js';

import { INTERNAL_PERMISSION_SEEDS } from './internal-rbac.catalog.js';
import type { InternalPermissionSeed } from './internal-rbac.permission-builder.js';

export { INTERNAL_PERMISSION_SEEDS };
export type { InternalPermissionSeed };

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
    'expedientes.leer',
    'expedientes.escribir',
    'expedientes.compartir',
    'systems.dashboard.read',
    'operations.catalogs.read',
    'operations.definitions.read',
    'operations.riskPolicy.read',
    'catalog.data.read',
    'reporting.read',
    'notifications.messages.read',
    'notifications.templates.read',
    // Encolar el alta de un usuario de comercio. Este rol es el que el ERP ve como `OPERATIONS` /
    // `COMMERCIAL_MANAGER` (ver `role-mapping.ts` del ERP), y es justo quien registra al usuario en
    // el CRM. Se le da PEDIR y no CONCEDER a propósito: conceder es de `MERCHANT_OPERATIONS`, y que
    // el mismo rol hiciera las dos cosas vaciaría de sentido la cola.
    'merchant.users.request',
    // Y ver la cola, para saber en qué quedó lo que pidió sin tener que preguntarlo por chat.
    'merchant.users.read',
    // Pedir la verificación del expediente del comercio y enlazarlo con su cuenta del ERP. Mismo
    // reparto: el ERP pide, el Motor decide y —si hay señales— una persona resuelve en su cola.
    'partner.kyb.request',
  ],
  OPERATIONS_ANALYST: [
    'auth.internal.me.read',
    'expedientes.leer',
    'expedientes.escribir',
    'operations.catalogs.read',
    'operations.definitions.read',
    'catalog.data.read',
  ],
  RISK_MANAGER: [
    'auth.internal.me.read',
    'expedientes.leer',
    'expedientes.escribir',
    'expedientes.compartir',
    'operations.riskPolicy.read',
    'catalog.data.read',
    'reporting.read',
    'audit.events.read',
  ],
  RISK_ANALYST: ['auth.internal.me.read', 'expedientes.leer', 'expedientes.escribir', 'operations.riskPolicy.read', 'catalog.data.read'],
  FRAUD_ANALYST: [
    'auth.internal.me.read',
    'expedientes.leer',
    'expedientes.escribir',
    'expedientes.pii.revelar',
    'operations.catalogs.read',
    'catalog.data.read',
    'audit.events.read',
  ],
  COMPLIANCE_MANAGER: [
    'auth.internal.me.read',
    'expedientes.leer',
    'expedientes.compartir',
    'expedientes.pii.revelar',
    'governance.data.read',
    'governance.policies.read',
    'audit.events.read',
    'audit.events.detail',
    'reporting.read',
  ],
  COMPLIANCE_ANALYST: [
    'auth.internal.me.read',
    'expedientes.leer',
    'governance.data.read',
    'governance.policies.read',
    'audit.events.read',
  ],
  COLLECTIONS_MANAGER: [
    'auth.internal.me.read',
    'expedientes.leer',
    'operations.catalogs.read',
    'operations.definitions.read',
    'reporting.read',
  ],
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
    'systems.flows.read',
    'systems.flows.analyze',
    'systems.flows.review',
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
    'systems.flows.read',
    'catalog.data.read',
  ],
  AUDITOR_READONLY: ['auth.internal.me.read', ...allReadPermissions],
  SUPPORT_AGENT: ['auth.internal.me.read', 'operations.catalogs.read', 'operations.definitions.read'],
  EXECUTIVE_READONLY: ['auth.internal.me.read', 'systems.dashboard.read', 'reporting.read', 'catalog.data.read'],
};
