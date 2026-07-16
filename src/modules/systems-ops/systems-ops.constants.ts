import { ToolSeed } from './systems-ops.types.js';

export const SYSTEMS_OPS_ROLES = [
  'system_admin',
  'platform_admin',
  'admin',
  'qa_engineer',
  'devops',
  'risk_analyst',
  'compliance_analyst',
  'readonly_auditor',
] as const;

/**
 * Roles separados por superficie de acción. `readonly_auditor` puede leer, pero nunca escribir.
 */
export const SYSTEMS_OPS_GOVERNANCE_ROLES = ['system_admin', 'platform_admin'] as const;
export const SYSTEMS_OPS_QA_ROLES = ['system_admin', 'platform_admin', 'qa_engineer'] as const;
export const SYSTEMS_OPS_STRESS_ROLES = ['system_admin', 'platform_admin', 'qa_engineer', 'devops'] as const;
export const SYSTEMS_OPS_WRITE_ROLES = SYSTEMS_OPS_GOVERNANCE_ROLES;

export function canReadAllSystemsOpsTenants(role: string): boolean {
  return role === 'system_admin' || role === 'platform_admin';
}

export const SYSTEM_TOOL_SEEDS: ToolSeed[] = [
  {
    code: 'POSTGRES',
    name: 'PostgreSQL',
    type: 'DATABASE',
    purpose: 'Base transaccional principal de Atlas.',
    requiredEnvVars: ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'],
    hasSandbox: true,
    requiresCredentials: true,
    isCritical: true,
  },
  { code: 'SEQUELIZE', name: 'Sequelize ORM', type: 'DATABASE_ORM', purpose: 'ORM y registro de modelos del backend.', isCritical: true },
  {
    code: 'REDIS',
    name: 'Redis',
    type: 'CACHE',
    purpose: 'Cache distribuida y base para rate limit/token cache.',
    requiredEnvVars: ['REDIS_URL'],
    hasSandbox: true,
    isCritical: true,
  },
  {
    code: 'NEST_THROTTLER_REDIS',
    name: 'Nest Throttler Redis Storage',
    type: 'RATE_LIMIT',
    purpose: 'Rate limiting distribuido por Redis.',
    requiredEnvVars: ['REDIS_URL'],
    hasSandbox: true,
    isCritical: true,
  },
  {
    code: 'JWT',
    name: 'JSON Web Tokens',
    type: 'AUTH',
    purpose: 'Autenticación de usuarios y sesiones.',
    requiredEnvVars: ['JWT_ACCESS_TOKEN_SECRET'],
    requiresCredentials: true,
    isCritical: true,
  },
  { code: 'ARGON2', name: 'Argon2', type: 'CRYPTO', purpose: 'Hash seguro de contraseñas.', isCritical: true },
  { code: 'ZOD', name: 'Zod', type: 'VALIDATION', purpose: 'Validación de DTOs y contratos de entrada.', isCritical: true },
  {
    code: 'OUTBOX_EVENTS_DB',
    name: 'Outbox DB-backed',
    type: 'OUTBOX',
    purpose: 'Eventos y jobs internos persistidos en base de datos.',
    isCritical: true,
  },
  {
    code: 'IDEMPOTENCY_KEYS_DB',
    name: 'Idempotency Keys DB',
    type: 'IDEMPOTENCY',
    purpose: 'Control de idempotencia para comandos críticos.',
    isCritical: true,
  },
  {
    code: 'OPERATIONAL_AUDIT_LOGS',
    name: 'Operational Audit Logs',
    type: 'OBSERVABILITY',
    purpose: 'Auditoría operacional compatible con el backend actual.',
    isCritical: true,
  },
  {
    code: 'SYSTEM_ACTION_LOGS',
    name: 'System Action Logs',
    type: 'OBSERVABILITY',
    purpose: 'Auditoría HTTP enriquecida por request, endpoint y correlación.',
    isCritical: true,
  },
  {
    code: 'ARCHIVO_LOG_MONGO_SYNC',
    name: 'Archivo.log → MongoDB Sync',
    type: 'OBSERVABILITY',
    provider: 'mongodb',
    purpose:
      'ArchivoLogMongoSyncService: único proceso del backend que corre por su cuenta (setInterval en ' +
      'onApplicationBootstrap, cada LOG_SYNC_INTERVAL_MS) — copia los bytes nuevos de Archivo.log ' +
      '(escrito por AppFileLogger) a una colección MongoDB append-only, sin intervención HTTP.',
    requiredEnvVars: ['MONGO_DB_URL_CONNECTION'],
    isCritical: false,
    isWorker: true,
    status: 'ACTIVE',
    ownerTeam: 'backend',
  },
  { code: 'JEST', name: 'Jest', type: 'TESTING', purpose: 'Pruebas unitarias y de integración del repositorio.', isCritical: false },
  {
    code: 'SMOKE_SCRIPTS',
    name: 'Smoke scripts',
    type: 'TESTING',
    purpose: 'Pruebas smoke existentes en scripts/smoke.',
    isCritical: false,
  },
  {
    code: 'OPENAPI_SWAGGER',
    name: 'Swagger/OpenAPI',
    type: 'OBSERVABILITY',
    purpose: 'Contrato de documentación técnica de la API.',
    isCritical: false,
  },
  {
    code: 'SEGIP_CGIP',
    name: 'SEGIP/CGIP',
    type: 'EXTERNAL_PROVIDER',
    purpose: 'Validación externa de identidad cuando exista contrato.',
    requiredEnvVars: ['SEGIP_BASE_URL', 'SEGIP_API_KEY'],
    hasSandbox: true,
    requiresCredentials: true,
    status: 'PLANNED',
  },
  {
    code: 'INFOCENTER',
    name: 'InfoCenter',
    type: 'EXTERNAL_PROVIDER',
    purpose: 'Buró crediticio costoso y gobernado por política.',
    requiredEnvVars: ['INFOCENTER_BASE_URL', 'INFOCENTER_API_KEY'],
    hasSandbox: true,
    requiresCredentials: true,
    status: 'PLANNED',
  },
  {
    code: 'QR_GENERIC',
    name: 'QR Generic Provider',
    type: 'EXTERNAL_PROVIDER',
    purpose: 'Proveedor contractual para validación de QR en fase posterior.',
    hasSandbox: true,
    status: 'PLANNED',
  },
  {
    code: 'BANKING_GENERIC',
    name: 'Banking Generic Provider',
    type: 'EXTERNAL_PROVIDER',
    purpose: 'Proveedor contractual para validación bancaria futura.',
    hasSandbox: true,
    status: 'PLANNED',
  },
  {
    code: 'TELCO_GENERIC',
    name: 'Telco Generic Provider',
    type: 'EXTERNAL_PROVIDER',
    purpose: 'Proveedor contractual para señales telco futuras.',
    hasSandbox: true,
    status: 'PLANNED',
  },
  {
    code: 'FACEBOOK_META',
    name: 'Facebook/Meta OAuth',
    type: 'EXTERNAL_PROVIDER',
    purpose: 'Proveedor social voluntario mediante OAuth/API oficial.',
    hasSandbox: true,
    status: 'PLANNED',
  },
  {
    code: 'WHATSAPP_GENERIC',
    name: 'WhatsApp Generic',
    type: 'NOTIFICATION',
    purpose: 'Proveedor contractual para contacto y comunicación WhatsApp.',
    hasSandbox: true,
    status: 'PLANNED',
  },
  {
    code: 'DIGITAL_TRUST_GENERIC',
    name: 'Digital Trust Generic',
    type: 'EXTERNAL_PROVIDER',
    purpose: 'Reputación digital, identidad sintética y señales email/IP/device.',
    hasSandbox: true,
    status: 'PLANNED',
  },
  {
    code: 'BULLMQ',
    name: 'BullMQ',
    type: 'QUEUE',
    purpose: 'Colas Redis futuras; actualmente no instalado y catalogado como planificado.',
    requiredEnvVars: ['REDIS_URL'],
    hasSandbox: true,
    status: 'PLANNED',
  },
  { code: 'AWS_SQS', name: 'AWS SQS', type: 'QUEUE', purpose: 'Alternativa futura de colas administradas.', status: 'PLANNED' },
  {
    code: 'S3_OR_OBJECT_STORAGE',
    name: 'S3/Object Storage',
    type: 'STORAGE',
    purpose: 'Almacenamiento futuro de evidencias, KYC y comprobantes.',
    requiredEnvVars: ['AWS_REGION', 'AWS_S3_BUCKET'],
    hasSandbox: true,
    requiresCredentials: true,
    status: 'PLANNED',
  },
];
