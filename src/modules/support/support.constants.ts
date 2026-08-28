/**
 * @file Catálogo declarativo del motor de soporte: tipos, estados, transiciones y códigos.
 * @business Define qué se puede pedir, en qué estados vive un caso y cómo se le explica al cliente.
 * @system fuente única de la taxonomía; el resto del módulo deriva de aquí y no redeclara literales.
 */

/** Los cuatro sujetos posibles de un caso. Separa permisos e información, no sólo etiquetas. */
export const SUBJECT_CONTEXT_TYPES = ['CONSUMER', 'PARTNER_USER', 'PARTNER_ORGANIZATION', 'INTERNAL'] as const;
export type SubjectContextType = (typeof SUBJECT_CONTEXT_TYPES)[number];

/** Quién actúa. `SYSTEM` representa temporizadores, enrutado y cierres automáticos. */
export const SUPPORT_ACTOR_TYPES = ['CUSTOMER', 'PARTNER_USER', 'AGENT', 'SUPERVISOR', 'SYSTEM'] as const;
export type SupportActorType = (typeof SUPPORT_ACTOR_TYPES)[number];

export const SUPPORT_CASE_TYPES = [
  'QUESTION',
  'SERVICE_REQUEST',
  'TECHNICAL_INCIDENT',
  'ACCOUNT_ACCESS',
  'IDENTITY_KYC',
  'CREDIT_DECISION_EXPLANATION',
  'PURCHASE_SUPPORT',
  'PAYMENT_EVIDENCE',
  'QR_SUPPORT',
  'PARTNER_ONBOARDING',
  'PARTNER_OPERATION',
  'RECONCILIATION_SUPPORT',
  'BILLING_MDR_SUPPORT',
  'COMPLAINT',
  'PRIVACY_REQUEST',
  'SECURITY_INCIDENT',
  'FRAUD_REPORT',
  'BUG_REPORT',
  'FEATURE_REQUEST',
  'DATA_CORRECTION_REQUEST',
  'OTHER',
] as const;
export type SupportCaseType = (typeof SUPPORT_CASE_TYPES)[number];

export const SUPPORT_DOMAINS = [
  'AUTH',
  'PROFILE',
  'KYC',
  'CREDIT',
  'PURCHASE',
  'INSTALLMENTS',
  'PAYMENT',
  'QR',
  'PARTNER',
  'NOTIFICATIONS',
  'DOCUMENTS',
  'REPORTING',
  'SECURITY',
  'PRIVACY',
  'PLATFORM',
  'OTHER',
] as const;
export type SupportDomain = (typeof SUPPORT_DOMAINS)[number];

export const SUPPORT_CASE_STATUSES = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'WAITING_INTERNAL',
  'WAITING_PARTNER',
  'ESCALATED',
  'ON_HOLD',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'DUPLICATE',
  'CANCELLED',
] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

/**
 * Qué transición es legítima desde cada estado.
 *
 * La tabla es explícita en vez de «todo vale mientras el agente sepa lo que hace» porque los saltos
 * imposibles son los que rompen la medición: un caso que pasa de NEW a CLOSED sin resolución deja un
 * expediente sin causa, sin respuesta comunicada y con el SLA en un limbo que nadie puede auditar.
 *
 * `CLOSED` sólo sale hacia `REOPENED`, y esa reapertura no borra el cierre anterior: incrementa un
 * contador y escribe un evento. Un caso reabierto que pareciera nuevo escondería justamente lo que
 * hay que medir — cuántas veces creímos haber resuelto algo que seguía roto.
 */
export const SUPPORT_CASE_TRANSITIONS: Readonly<Record<SupportCaseStatus, readonly SupportCaseStatus[]>> = {
  NEW: ['TRIAGED', 'ASSIGNED', 'DUPLICATE', 'CANCELLED', 'ESCALATED'],
  TRIAGED: ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'DUPLICATE', 'CANCELLED', 'ON_HOLD'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'WAITING_PARTNER', 'ESCALATED', 'TRIAGED', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'WAITING_INTERNAL', 'WAITING_PARTNER', 'ESCALATED', 'RESOLVED', 'ON_HOLD', 'DUPLICATE', 'CANCELLED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'CANCELLED', 'CLOSED'],
  WAITING_INTERNAL: ['IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'CANCELLED'],
  WAITING_PARTNER: ['IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'CANCELLED'],
  ESCALATED: ['IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'WAITING_PARTNER', 'RESOLVED', 'ON_HOLD'],
  ON_HOLD: ['IN_PROGRESS', 'ASSIGNED', 'ESCALATED', 'CANCELLED'],
  RESOLVED: ['CLOSED', 'REOPENED', 'IN_PROGRESS'],
  CLOSED: ['REOPENED'],
  REOPENED: ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'TRIAGED'],
  DUPLICATE: ['CLOSED', 'REOPENED'],
  CANCELLED: ['REOPENED'],
};

/**
 * Lo que el cliente lee, frente a lo que el sistema sabe.
 *
 * `WAITING_INTERNAL` es preciso para operar e ilegible para quien espera: le dice que su problema
 * está detenido por algo suyo que no entiende. La traducción no es maquillaje — es la diferencia
 * entre informar y exhibir la cocina.
 */
export const CUSTOMER_VISIBLE_STATUS: Readonly<Record<SupportCaseStatus, string>> = {
  NEW: 'Recibido',
  TRIAGED: 'En revisión',
  ASSIGNED: 'Asignado',
  IN_PROGRESS: 'Estamos trabajando',
  WAITING_CUSTOMER: 'Necesitamos tu respuesta',
  WAITING_INTERNAL: 'Estamos investigando',
  WAITING_PARTNER: 'Estamos coordinando con el comercio',
  ESCALATED: 'Estamos investigando',
  ON_HOLD: 'En pausa',
  RESOLVED: 'Solución enviada',
  CLOSED: 'Cerrado',
  REOPENED: 'Reabierto',
  DUPLICATE: 'Unido a otro caso tuyo',
  CANCELLED: 'Cancelado',
};

export const SUPPORT_IMPACTS = ['INDIVIDUAL', 'MULTI_USER', 'PARTNER', 'MULTI_PARTNER', 'REGIONAL', 'PLATFORM_WIDE'] as const;
export type SupportImpact = (typeof SUPPORT_IMPACTS)[number];

export const SUPPORT_URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type SupportUrgency = (typeof SUPPORT_URGENCIES)[number];

export const SUPPORT_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_SENSITIVITIES = ['NORMAL', 'SENSITIVE', 'RESTRICTED'] as const;
export type SupportSensitivity = (typeof SUPPORT_SENSITIVITIES)[number];

export const SUPPORT_CHANNEL_STATUSES = [
  'REQUESTED',
  'QUEUED',
  'OPEN',
  'WAITING_USER',
  'WAITING_AGENT',
  'CLOSING',
  'CLOSED',
  'ABANDONED',
] as const;
export type SupportChannelStatus = (typeof SUPPORT_CHANNEL_STATUSES)[number];

export const SUPPORT_CHANNEL_CLOSE_REASONS = [
  'USER_ENDED',
  'AGENT_ENDED',
  'IDLE_TIMEOUT',
  'TRANSFERRED_TO_ASYNC',
  'ABUSE_POLICY',
  'SYSTEM_FAILURE',
] as const;
export type SupportChannelCloseReason = (typeof SUPPORT_CHANNEL_CLOSE_REASONS)[number];

export const SUPPORT_RESOLUTION_CODES = [
  'ANSWERED',
  'USER_GUIDANCE',
  'CONFIGURATION_FIXED',
  'ACCESS_RESTORED',
  'DOCUMENT_RECEIVED',
  'PAYMENT_EVIDENCE_ACCEPTED',
  'PAYMENT_EVIDENCE_REJECTED',
  'DUPLICATE',
  'KNOWN_ISSUE',
  'BUG_FIXED',
  'WORKAROUND_PROVIDED',
  'NO_ISSUE_FOUND',
  'USER_ERROR',
  'PARTNER_ACTION_REQUIRED',
  'INTERNAL_OPERATION_COMPLETED',
  'SECURITY_ACTION_COMPLETED',
  'FRAUD_ESCALATED',
  'POLICY_EXPLANATION',
  'OUT_OF_SCOPE',
] as const;
export type SupportResolutionCode = (typeof SUPPORT_RESOLUTION_CODES)[number];

export const SUPPORT_ROOT_CAUSE_CODES = [
  'APPLICATION_DEFECT',
  'CONFIGURATION',
  'INFRASTRUCTURE',
  'THIRD_PARTY',
  'NETWORK',
  'USER_MISUNDERSTANDING',
  'DATA_QUALITY',
  'PROCESS_FAILURE',
  'PARTNER_PROCESS',
  'SECURITY_EVENT',
  'FRAUD',
  'POLICY',
  'UNKNOWN',
] as const;
export type SupportRootCauseCode = (typeof SUPPORT_ROOT_CAUSE_CODES)[number];

export const SUPPORT_AGENT_SKILLS = [
  'CONSUMER_SUPPORT',
  'PARTNER_SUPPORT',
  'AUTH',
  'KYC',
  'CREDIT',
  'QR',
  'RECONCILIATION',
  'SECURITY',
  'FRAUD',
  'PRIVACY',
] as const;
export type SupportAgentSkill = (typeof SUPPORT_AGENT_SKILLS)[number];

export const SUPPORT_AGENT_LEVELS = ['L1', 'L2', 'SPECIALIST', 'SUPERVISOR', 'MANAGER'] as const;
export type SupportAgentLevel = (typeof SUPPORT_AGENT_LEVELS)[number];

export const SUPPORT_PRESENCE_STATES = ['AVAILABLE', 'BUSY', 'AWAY', 'OFFLINE', 'TRAINING', 'WRAP_UP'] as const;
export type SupportPresenceState = (typeof SUPPORT_PRESENCE_STATES)[number];

export const SUPPORT_CASE_LINK_TYPES = [
  'DUPLICATE_OF',
  'RELATED_TO',
  'CAUSED_BY',
  'PARENT_OF',
  'CHILD_OF',
  'FOLLOW_UP_OF',
  'PROBLEM_OF',
  'SECURITY_INCIDENT_OF',
] as const;
export type SupportCaseLinkType = (typeof SUPPORT_CASE_LINK_TYPES)[number];

export const SUPPORT_MESSAGE_TYPES = [
  'TEXT',
  'SYSTEM_EVENT',
  'ATTACHMENT',
  'IMAGE',
  'DOCUMENT',
  'FORM_REQUEST',
  'FORM_RESPONSE',
  'KNOWLEDGE_REFERENCE',
  'CASE_STATUS_UPDATE',
  'AGENT_TRANSFER_NOTICE',
  'SECURITY_WARNING',
  'INTERNAL_NOTE',
] as const;
export type SupportMessageType = (typeof SUPPORT_MESSAGE_TYPES)[number];

export const SUPPORT_MESSAGE_VISIBILITIES = ['PUBLIC', 'INTERNAL', 'SYSTEM'] as const;
export type SupportMessageVisibility = (typeof SUPPORT_MESSAGE_VISIBILITIES)[number];

/** Tipos de evento del expediente. Son la historia, no el estado. */
export const SUPPORT_CASE_EVENT_TYPES = [
  'CASE_CREATED',
  'CASE_TRIAGED',
  'CASE_ASSIGNED',
  'CASE_TRANSFERRED',
  'CASE_PRIORITY_CHANGED',
  'CASE_ESCALATED',
  'CASE_STATUS_CHANGED',
  'CASE_RESOLVED',
  'CASE_CLOSED',
  'CASE_REOPENED',
  'CASE_LINKED',
  'CASE_REFERENCE_ADDED',
  'CASE_NOTE_ADDED',
  'CHANNEL_OPENED',
  'CHANNEL_CLOSED',
  'FIRST_RESPONSE_RECORDED',
  'CONTENT_REDACTED_FROM_VIEW',
  'SLA_WARNING',
  'SLA_BREACHED',
  'SLA_CLOCK_PAUSED',
  'SLA_CLOCK_RESUMED',
  'FEEDBACK_SUBMITTED',
  'LEGAL_HOLD_ENABLED',
  'LEGAL_HOLD_RELEASED',
  'CLOSE_REQUESTED',
  'REOPEN_REQUESTED',
] as const;
export type SupportCaseEventType = (typeof SUPPORT_CASE_EVENT_TYPES)[number];

/**
 * Tipos de caso que NUNCA se cierran solos.
 *
 * El cierre automático existe para que una consulta contestada no quede abierta seis meses porque
 * nadie dijo «gracias». Aplicarlo a un incidente de seguridad, un fraude, un reclamo formal o una
 * solicitud de privacidad convertiría el silencio de una persona en la conformidad que la empresa
 * necesitaba: exactamente el resultado que ninguna de esas cuatro figuras admite.
 */
export const NEVER_AUTO_CLOSE_CASE_TYPES: readonly SupportCaseType[] = [
  'SECURITY_INCIDENT',
  'FRAUD_REPORT',
  'COMPLAINT',
  'PRIVACY_REQUEST',
];

/** Casos que nacen con visibilidad restringida y cola especializada, sin esperar a que alguien lo note. */
export const SECURITY_SENSITIVE_CASE_TYPES: readonly SupportCaseType[] = [
  'SECURITY_INCIDENT',
  'FRAUD_REPORT',
  'ACCOUNT_ACCESS',
  'PRIVACY_REQUEST',
];

/** Códigos de cola sembrados por el catálogo de producción. Los usa el enrutado por defecto. */
export const SUPPORT_QUEUE_CODES = {
  CONSUMER_L1: 'consumer_l1',
  CONSUMER_L2: 'consumer_l2',
  PARTNER_L1: 'partner_l1',
  PARTNER_OPERATIONS: 'partner_operations',
  CREDIT_SPECIALIST: 'credit_specialist',
  SECURITY_FRAUD: 'security_fraud',
  PRIVACY: 'privacy',
  COMPLAINTS: 'complaints',
} as const;

/** Clases de retención declaradas por el motor. Cada una tiene su política sembrada. */
export const SUPPORT_RETENTION_CLASSES = {
  GENERAL: 'support_general',
  COMPLAINT: 'support_complaint',
  SECURITY_INCIDENT: 'support_security_incident',
  PRIVACY: 'support_privacy_request',
  FINANCIAL_EVIDENCE: 'support_financial_evidence',
} as const;

/** Longitud máxima de un mensaje. Un chat no es un canal de carga de archivos por texto. */
export const SUPPORT_MESSAGE_MAX_LENGTH = 4000;

/** Ventana por defecto para reabrir un caso cerrado. Fuera de ella se crea un `FOLLOW_UP_OF`. */
export const SUPPORT_REOPEN_WINDOW_DAYS = 14;
