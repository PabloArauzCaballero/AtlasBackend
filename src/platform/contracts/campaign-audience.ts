/**
 * @file Puerto de audiencia de campañas: a quién alcanza una campaña de notificación.
 * @business Quien programa una campaña elige un segmento («clientes de Santa Cruz con una cuota
 *   vencida») y necesita saber cuántas personas son antes de enviar, y por qué canal les llegará.
 * @system Vive en plataforma por la misma razón que el directorio de destinatarios: Mensajería consume
 *   la audiencia y Clientes la resuelve, y ninguno de los dos puede importar al otro sin cerrar un
 *   ciclo. La respuesta son identificadores opacos y banderas de canal; nunca un teléfono ni un correo.
 */

/** Atributos por los que se puede segmentar. Vocabulario CERRADO: una regla fuera de él se rechaza al validar. */
export const AUDIENCE_ATTRIBUTES = [
  'city',
  'department',
  'lifecycleStatus',
  'hasCreditLine',
  'hasActiveLoan',
  'hasOverdueInstallment',
  'daysSinceSignup',
  'hasPushDevice',
  'pushPlatform',
  'hasVerifiedEmail',
  'marketingOptIn',
] as const;
export type AudienceAttribute = (typeof AUDIENCE_ATTRIBUTES)[number];

export const AUDIENCE_OPERATORS = ['eq', 'neq', 'in', 'not_in', 'gte', 'lte', 'is_true', 'is_false'] as const;
export type AudienceOperator = (typeof AUDIENCE_OPERATORS)[number];

/**
 * Qué operadores admite cada atributo. Lo comparten la validación de entrada (Mensajería) y el
 * constructor de SQL (Clientes): si divergieran, una regla aceptada al programar reventaría al enviar.
 */
export const AUDIENCE_OPERATORS_BY_ATTRIBUTE: Readonly<Record<AudienceAttribute, readonly AudienceOperator[]>> = Object.freeze({
  city: ['eq', 'neq', 'in', 'not_in'],
  department: ['eq', 'neq', 'in', 'not_in'],
  lifecycleStatus: ['eq', 'neq', 'in', 'not_in'],
  hasCreditLine: ['is_true', 'is_false'],
  hasActiveLoan: ['is_true', 'is_false'],
  hasOverdueInstallment: ['is_true', 'is_false'],
  daysSinceSignup: ['gte', 'lte'],
  hasPushDevice: ['is_true', 'is_false'],
  pushPlatform: ['eq', 'in'],
  hasVerifiedEmail: ['is_true', 'is_false'],
  marketingOptIn: ['is_true', 'is_false'],
});

export type AudienceRule = Readonly<{
  attribute: AudienceAttribute;
  operator: AudienceOperator;
  /** Texto para `eq`/`neq`, lista para `in`/`not_in`, número para `gte`/`lte`; ausente en `is_true`/`is_false`. */
  value?: string | number | readonly string[];
}>;

export type AudienceDefinition = Readonly<{
  /** `all`: la persona cumple TODAS las reglas; `any`: basta una. Sin reglas, la audiencia es «todos los activos». */
  match: 'all' | 'any';
  rules: readonly AudienceRule[];
}>;

export type AudienceOptions = Readonly<{
  /** Si es verdadero, sólo entra quien dio el consentimiento de comunicaciones comerciales. */
  requireMarketingConsent: boolean;
}>;

export type AudienceEstimate = Readonly<{
  total: number;
  withPushDevice: number;
  withVerifiedEmail: number;
  estimatedAt: string;
}>;

export type AudienceMember = Readonly<{
  customerId: string;
  hasPushDevice: boolean;
  hasVerifiedEmail: boolean;
}>;

export interface CampaignAudiencePort {
  estimate(tenantId: string, definition: AudienceDefinition, options: AudienceOptions): Promise<AudienceEstimate>;
  /**
   * Una página de la audiencia, ordenada por identificador. `afterCustomerId` es el cursor: la
   * materialización de una campaña grande se hace por tandas y puede retomarse tras un reinicio.
   */
  listMembers(
    tenantId: string,
    definition: AudienceDefinition,
    options: AudienceOptions,
    page: Readonly<{ afterCustomerId: string | null; limit: number }>,
  ): Promise<readonly AudienceMember[]>;
}

export const CAMPAIGN_AUDIENCE_PORT = 'atlas.notifications.campaign-audience-port';
