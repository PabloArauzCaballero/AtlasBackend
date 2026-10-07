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
  'workflows.read',
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
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
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
    // Anular al desembolsar la tasa que decidió el Motor o la del producto (Frente 3A). Sigue
    // clampeada al rango del producto y al tope de usura; exige motivo.
    'credit.loan_disbursement.override_rate',
  ],
  OPERATIONS_ANALYST: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
    'expedientes.leer',
    'expedientes.escribir',
    'operations.catalogs.read',
    'operations.definitions.read',
    'catalog.data.read',
  ],
  RISK_MANAGER: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
    'expedientes.leer',
    'expedientes.escribir',
    'expedientes.compartir',
    'operations.riskPolicy.read',
    'catalog.data.read',
    'reporting.read',
    'audit.events.read',
    // La decisión manual del expediente de un comercio cuando el Motor no abrió caso.
    'partner.kyb.decide',
    // Y la decisión sobre la habilitación crediticia de un cliente (incluida la excepción).
    'customers.eligibility.decide',
  ],
  RISK_ANALYST: [
    'auth.internal.me.read',
    'workflows.read',
    'expedientes.leer',
    'expedientes.escribir',
    'operations.riskPolicy.read',
    'catalog.data.read',
    // Decidir la habilitación crediticia de un cliente (decisión de mínimo privilegio, 2026-10-07).
    'customers.eligibility.decide',
  ],
  FRAUD_ANALYST: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
    'expedientes.leer',
    'expedientes.escribir',
    'expedientes.pii.revelar',
    'operations.catalogs.read',
    'catalog.data.read',
    'audit.events.read',
  ],
  COMPLIANCE_MANAGER: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
    'expedientes.leer',
    'expedientes.compartir',
    'expedientes.pii.revelar',
    'governance.data.read',
    'governance.policies.read',
    'audit.events.read',
    'audit.events.detail',
    'reporting.read',
    // Solicitudes de derechos del titular (hallazgo A5): la jefatura ve la cola y la cierra.
    'privacy.requests.read',
    'privacy.requests.manage',
    // Habilitar o suspender a un cliente por KYC/observaciones es también decisión de cumplimiento.
    'customers.eligibility.decide',
    // Decisión manual del expediente KYB del comercio cuando el Motor no abrió caso.
    'partner.kyb.decide',
  ],
  COMPLIANCE_ANALYST: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
    'expedientes.leer',
    'governance.data.read',
    'governance.policies.read',
    'audit.events.read',
    // Vigila los plazos de las solicitudes del titular; cerrarlas es de COMPLIANCE_MANAGER.
    'privacy.requests.read',
    // Decisión manual del expediente KYB del comercio (decisión de mínimo privilegio, 2026-10-07).
    'partner.kyb.decide',
  ],
  COLLECTIONS_MANAGER: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
    'expedientes.leer',
    'operations.catalogs.read',
    'operations.definitions.read',
    'reporting.read',
  ],
  COLLECTIONS_AGENT: ['auth.internal.me.read', 'workflows.read', 'operations.catalogs.read', 'operations.definitions.read'],
  FINANCE_MANAGER: ['auth.internal.me.read', 'workflows.read', 'reporting.read', 'reporting.execute', 'audit.events.read'],
  MERCHANT_OPERATIONS: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
    'operations.catalogs.read',
    'operations.definitions.read',
    // Alta y ciclo de vida de las identidades del comercio: es la contraparte de identidad del
    // onboarding que este rol ya hace. Antes no existía la población, y el ERP terminaba
    // fabricando el rol de comercio a partir de ESTE rol interno.
    'merchant.users.read',
    'merchant.users.manage',
    // Revisar el QR de cobro que sube el comercio. Va con CONCEDER y no con PEDIR: es el mismo rol
    // que da de alta las identidades del comercio, y el ERP —que pide— no tiene que poder activar la
    // cuenta a la que van los cobros.
    'partner.qr.review',
    // Y decidir a mano el expediente cuando el Motor no abrió caso (la degradación). Mismo motivo:
    // el ERP, que pide la verificación, no la decide.
    'partner.kyb.decide',
  ],
  DATA_GOVERNANCE_MANAGER: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
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
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
    'catalog.data.read',
    'dataQuality.issues.read',
    'dataQuality.issues.resolve',
    'dataQuality.rules.read',
    'dataQuality.rules.manage',
  ],
  QA_ENGINEER: [
    'auth.internal.me.read',
    // Procesos: la ficha de negocio de lo que opera este rol (plan de procesos 2026-09-26).
    'workflows.read',
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
  EXECUTIVE_READONLY: ['auth.internal.me.read', 'workflows.read', 'systems.dashboard.read', 'reporting.read', 'catalog.data.read'],
};
