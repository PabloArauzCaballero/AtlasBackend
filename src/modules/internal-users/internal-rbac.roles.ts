export const INTERNAL_ROLE_CODES = [
  'SUPER_ADMIN',
  'SYSTEMS_ADMIN',
  'INTERNAL_IDENTITY_ADMIN',
  'OPERATIONS_MANAGER',
  'OPERATIONS_ANALYST',
  'RISK_MANAGER',
  'RISK_ANALYST',
  'FRAUD_ANALYST',
  'COMPLIANCE_MANAGER',
  'COMPLIANCE_ANALYST',
  'COLLECTIONS_MANAGER',
  'COLLECTIONS_AGENT',
  'FINANCE_MANAGER',
  'MERCHANT_OPERATIONS',
  'DATA_GOVERNANCE_MANAGER',
  'DATA_QUALITY_ANALYST',
  'QA_ENGINEER',
  'AUDITOR_READONLY',
  'SUPPORT_AGENT',
  'EXECUTIVE_READONLY',
] as const;

export type InternalRoleCode = (typeof INTERNAL_ROLE_CODES)[number];

export type InternalRoleSeed = {
  code: InternalRoleCode;
  name: string;
  description: string;
  department: string;
  legacyRoleCode: string;
  isSystemRole: boolean;
};

function role(
  code: InternalRoleCode,
  name: string,
  description: string,
  department: string,
  legacyRoleCode = 'internal_operator',
): InternalRoleSeed {
  return { code, name, description, department, legacyRoleCode, isSystemRole: true };
}

export const INTERNAL_ROLE_SEEDS: readonly InternalRoleSeed[] = [
  role(
    'SUPER_ADMIN',
    'Superadministrador ATLAS',
    'Acceso total al backend interno; reservado a bootstrap y emergencia auditada.',
    'SYSTEMS',
    'admin',
  ),
  role(
    'SYSTEMS_ADMIN',
    'Administrador de sistemas',
    'Administra configuración operativa, catálogo técnico, QA, jobs y observabilidad.',
    'SYSTEMS',
    'admin',
  ),
  role(
    'INTERNAL_IDENTITY_ADMIN',
    'Administrador de identidad interna',
    'Crea usuarios, asigna roles y gestiona bloqueos internos.',
    'SYSTEMS',
    'admin',
  ),
  role('OPERATIONS_MANAGER', 'Jefatura de operaciones', 'Gestiona colas operativas, asignaciones y revisión de casos.', 'OPERATIONS'),
  role('OPERATIONS_ANALYST', 'Analista de operaciones', 'Consulta y atiende casos operativos asignados.', 'OPERATIONS'),
  role('RISK_MANAGER', 'Jefatura de riesgo', 'Revisa scoring, políticas de riesgo y overrides controlados.', 'RISK', 'risk_analyst'),
  role('RISK_ANALYST', 'Analista de riesgo', 'Consulta expedientes, scoring y explicabilidad de riesgo.', 'RISK', 'risk_analyst'),
  role(
    'FRAUD_ANALYST',
    'Analista de fraude',
    'Investiga señales, watchlists, casos de fraude y vínculos sospechosos.',
    'RISK',
    'fraud_analyst',
  ),
  role(
    'COMPLIANCE_MANAGER',
    'Jefatura de cumplimiento',
    'Gobierna KYC, consentimientos, privacidad, auditoría y requerimientos regulatorios.',
    'COMPLIANCE',
    'compliance_analyst',
  ),
  role(
    'COMPLIANCE_ANALYST',
    'Analista de cumplimiento',
    'Consulta y revisa KYC, consentimientos, privacidad y evidencias.',
    'COMPLIANCE',
    'compliance_analyst',
  ),
  role('COLLECTIONS_MANAGER', 'Jefatura de cobranza', 'Gestiona mora, estrategias de cobranza y asignación de cartera.', 'COLLECTIONS'),
  role(
    'COLLECTIONS_AGENT',
    'Agente de cobranza',
    'Atiende recordatorios, promesas de pago y acciones de cobranza asignadas.',
    'COLLECTIONS',
  ),
  role(
    'FINANCE_MANAGER',
    'Jefatura financiera',
    'Consulta y administra conciliación, liquidaciones y reportes financieros internos.',
    'FINANCE',
  ),
  role('MERCHANT_OPERATIONS', 'Operaciones de comercios', 'Gestiona onboarding, soporte y operación diaria de comercios.', 'OPERATIONS'),
  role(
    'DATA_GOVERNANCE_MANAGER',
    'Gobierno de datos',
    'Administra catálogo, metadata de negocio, sensibilidad y ownership.',
    'SYSTEMS',
    'admin',
  ),
  role('DATA_QUALITY_ANALYST', 'Analista de calidad de datos', 'Revisa reglas, incidencias y resultados de calidad de datos.', 'SYSTEMS'),
  role('QA_ENGINEER', 'QA interno', 'Ejecuta suites controladas, revisa endpoints y reportes de pruebas.', 'SYSTEMS', 'qa_engineer'),
  role(
    'AUDITOR_READONLY',
    'Auditor solo lectura',
    'Consulta auditoría, catálogos y reportes sin capacidad de mutación.',
    'AUDIT',
    'readonly_auditor',
  ),
  role('SUPPORT_AGENT', 'Soporte interno', 'Consulta información mínima para soporte a clientes y comercios.', 'SUPPORT'),
  role(
    'EXECUTIVE_READONLY',
    'Ejecutivo solo lectura',
    'Consulta dashboards ejecutivos y métricas sin datos mutables.',
    'EXECUTIVE',
    'readonly_auditor',
  ),
];

export function legacyRoleForInternalRoles(roleCodes: readonly string[]): string {
  const normalized = new Set(roleCodes);
  if (normalized.has('SUPER_ADMIN') || normalized.has('SYSTEMS_ADMIN') || normalized.has('INTERNAL_IDENTITY_ADMIN')) return 'admin';
  if (normalized.has('RISK_MANAGER') || normalized.has('RISK_ANALYST')) return 'risk_analyst';
  if (normalized.has('FRAUD_ANALYST')) return 'fraud_analyst';
  if (normalized.has('COMPLIANCE_MANAGER') || normalized.has('COMPLIANCE_ANALYST')) return 'compliance_analyst';
  if (normalized.has('QA_ENGINEER')) return 'qa_engineer';
  if (normalized.has('AUDITOR_READONLY') || normalized.has('EXECUTIVE_READONLY')) return 'readonly_auditor';
  return 'internal_operator';
}
