/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de types sin introducir reglas de un dominio específico.
 */
/**
 * Vocabulario ÚNICO de roles del claim `role` del access token. Antes esta lista existía tres
 * veces —la unión de tipos aquí, y un `KNOWN_ROLES` duplicado en `jwt-auth.guard.ts` y en
 * `auth-actor-resolver.service.ts`—, así que añadir un rol en un sitio y olvidarlo en otro dejaba
 * un rol que el resolver acepta pero el guard rechaza (o al revés): una divergencia silenciosa
 * entre "quién puede iniciar sesión" y "qué token se acepta". Con la constante como fuente de
 * verdad, el tipo y ambos conjuntos se derivan de ella y no pueden desincronizarse.
 */
export const ATLAS_USER_ROLES = [
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'system',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
  'merchant',
  'admin',
  'platform_admin',
] as const;

export type AtlasUserRole = (typeof ATLAS_USER_ROLES)[number];

export type AuthenticatedUser = {
  sub: string;
  tenantId?: string;
  customerId?: string;
  internalUserId?: string;
  platformUserId?: string;
  role: AtlasUserRole;
  tokenVersion?: number;
};

export type RequestWithAuth = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
  ip?: string;
  correlationId?: string;
};
