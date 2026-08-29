/**
 * @file Contratos de entrada: valida y normaliza antes de que nada toque el dominio.
 * @business Lo que alguien declara al pedir ayuda y lo que el equipo declara al trabajar el caso.
 * @system esquemas Zod del expediente, el canal y los mensajes de soporte.
 */
import { z } from 'zod';
import {
  SUPPORT_CASE_LINK_TYPES,
  SUPPORT_CASE_TYPES,
  SUPPORT_CHANNEL_CLOSE_REASONS,
  SUPPORT_DOMAINS,
  SUPPORT_IMPACTS,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_PRIORITIES,
  SUPPORT_RESOLUTION_CODES,
  SUPPORT_ROOT_CAUSE_CODES,
  SUPPORT_URGENCIES,
} from './support.constants.js';

const positiveId = z.string().regex(/^[1-9][0-9]*$/u, 'Identificador inválido.');

/**
 * El contexto técnico que la app manda al abrir soporte desde un error.
 *
 * Se acepta un conjunto CERRADO de campos y ninguno de texto libre largo: el objetivo es que el
 * agente pueda buscar la traza, no que el cliente termine enviando el volcado de un stack trace con
 * datos de otras personas dentro.
 */
export const originContextSchema = z
  .object({
    correlationId: z.string().trim().max(64).optional(),
    traceId: z.string().trim().max(64).optional(),
    appVersion: z.string().trim().max(30).optional(),
    platform: z.enum(['ios', 'android', 'web', 'erp', 'admin']).optional(),
    build: z.string().trim().max(30).optional(),
    screen: z.string().trim().max(80).optional(),
    errorCode: z.string().trim().max(60).optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .strict();

/** Referencia a una entidad de Atlas (compra, cuota, pago, verificación) de la que trata el caso. */
export const caseReferenceSchema = z.object({
  entityType: z.enum([
    'purchase',
    'loan',
    'installment',
    'payment',
    'payment_claim',
    'credit_application',
    'credit_decision',
    'kyc_verification',
    'notification',
    'partner_qr',
    'partner_pos_terminal',
    'reconciliation_item',
    'session',
    'device',
  ]),
  entityId: z.string().trim().min(1).max(64),
  relationType: z.enum(['ABOUT', 'EVIDENCE_OF', 'AFFECTED_BY', 'CAUSED_BY']).default('ABOUT'),
  snapshotLabel: z.string().trim().max(200).optional(),
});

/**
 * Abrir un caso.
 *
 * `categoryCode` es obligatorio y no un texto libre: es lo que decide cola, sensibilidad y SLA. La
 * descripción sí es libre —es el relato de la persona— pero el motivo tiene que ser del catálogo,
 * porque «no me reconocen el pago» escrito de veinte maneras no se puede contar ni enrutar.
 */
export const openCaseSchema = z.object({
  categoryCode: z.string().trim().min(2).max(80),
  caseType: z.enum(SUPPORT_CASE_TYPES).optional(),
  domain: z.enum(SUPPORT_DOMAINS).optional(),
  title: z.string().trim().min(4).max(200),
  description: z.string().trim().min(4).max(4000),
  urgency: z.enum(SUPPORT_URGENCIES).optional(),
  impact: z.enum(SUPPORT_IMPACTS).optional(),
  locale: z.string().trim().max(10).default('es-BO'),
  partnerProfileId: positiveId.optional(),
  references: z.array(caseReferenceSchema).max(10).optional(),
  originContext: originContextSchema.optional(),
  /** Confirma que quiere abrir otro caso pese al aviso de duplicado. */
  acknowledgeDuplicate: z.boolean().default(false),
});
export type OpenCaseDto = z.infer<typeof openCaseSchema>;

export const listCasesQuerySchema = z.object({
  status: z.string().trim().max(200).optional(),
  priority: z.string().trim().max(20).optional(),
  queueId: positiveId.optional(),
  assignedToMe: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursorOpenedAt: z.string().datetime().optional(),
  cursorId: positiveId.optional(),
});
export type ListCasesQueryDto = z.infer<typeof listCasesQuerySchema>;

/** Clasificar el caso. Es lo que lo convierte en trabajo medible. */
export const triageCaseSchema = z.object({
  categoryCode: z.string().trim().min(2).max(80).optional(),
  caseType: z.enum(SUPPORT_CASE_TYPES).optional(),
  domain: z.enum(SUPPORT_DOMAINS).optional(),
  impact: z.enum(SUPPORT_IMPACTS).optional(),
  urgency: z.enum(SUPPORT_URGENCIES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  queueCode: z.string().trim().min(2).max(60).optional(),
  internalSummary: z.string().trim().max(4000).optional(),
  reason: z.string().trim().min(4).max(400),
});
export type TriageCaseDto = z.infer<typeof triageCaseSchema>;

export const assignCaseSchema = z.object({
  agentProfileId: positiveId.optional(),
  queueCode: z.string().trim().min(2).max(60).optional(),
  reason: z.string().trim().min(4).max(200),
});
export type AssignCaseDto = z.infer<typeof assignCaseSchema>;

/**
 * Escalar.
 *
 * `notifyCustomer` existe porque escalar sin decírselo a quien espera produce el mismo silencio que
 * no escalar: la persona sigue sin saber nada, sólo que ahora hay más gente sin contarle.
 */
export const escalateCaseSchema = z.object({
  escalationType: z.enum(['FUNCTIONAL', 'HIERARCHICAL', 'SECURITY', 'FRAUD', 'PRIVACY']),
  targetQueueCode: z.string().trim().min(2).max(60).optional(),
  reason: z.string().trim().min(10).max(400),
  notifyCustomer: z.boolean().default(true),
});
export type EscalateCaseDto = z.infer<typeof escalateCaseSchema>;

/** Resolver exige las dos versiones: la que se le dice al cliente y la que queda para el equipo. */
export const resolveCaseSchema = z.object({
  resolutionCode: z.enum(SUPPORT_RESOLUTION_CODES),
  rootCauseCode: z.enum(SUPPORT_ROOT_CAUSE_CODES).default('UNKNOWN'),
  customerResolution: z.string().trim().min(10).max(4000),
  internalResolution: z.string().trim().min(10).max(4000),
  workaroundDescription: z.string().trim().max(2000).optional(),
});
export type ResolveCaseDto = z.infer<typeof resolveCaseSchema>;

export const closeCaseSchema = z.object({
  reason: z.string().trim().min(4).max(400),
});
export type CloseCaseDto = z.infer<typeof closeCaseSchema>;

export const reopenCaseSchema = z.object({
  reason: z.string().trim().min(10).max(400),
});
export type ReopenCaseDto = z.infer<typeof reopenCaseSchema>;

export const internalNoteSchema = z.object({
  body: z.string().trim().min(2).max(SUPPORT_MESSAGE_MAX_LENGTH),
});
export type InternalNoteDto = z.infer<typeof internalNoteSchema>;

export const linkCaseSchema = z.object({
  linkedCaseId: positiveId,
  linkType: z.enum(SUPPORT_CASE_LINK_TYPES),
  note: z.string().trim().max(400).optional(),
});
export type LinkCaseDto = z.infer<typeof linkCaseSchema>;

export const caseFeedbackSchema = z.object({
  csatScore: z.number().int().min(1).max(5),
  effortScore: z.number().int().min(1).max(7).optional(),
  comment: z.string().trim().max(2000).optional(),
});
export type CaseFeedbackDto = z.infer<typeof caseFeedbackSchema>;

/** Pedir atención. El canal se crea aunque no haya nadie libre: entonces queda encolado. */
export const openChannelSchema = z.object({
  categoryCode: z.string().trim().min(2).max(80).optional(),
  caseId: positiveId.optional(),
  partnerProfileId: positiveId.optional(),
  subject: z.string().trim().max(200).optional(),
  locale: z.string().trim().max(10).default('es-BO'),
});
export type OpenChannelDto = z.infer<typeof openChannelSchema>;

/**
 * Enviar un mensaje.
 *
 * `clientMessageId` lo genera quien envía y es obligatorio: es la única forma de que un reintento
 * por mala red no duplique lo que el cliente ya dijo.
 */
export const sendMessageSchema = z.object({
  clientMessageId: z.string().trim().min(8).max(64),
  body: z.string().trim().min(1).max(SUPPORT_MESSAGE_MAX_LENGTH),
  messageType: z.enum(['TEXT', 'ATTACHMENT', 'IMAGE', 'DOCUMENT', 'FORM_RESPONSE']).default('TEXT'),
  replyToMessageId: positiveId.optional(),
  attachment: z
    .object({
      storageObjectKey: z.string().trim().min(8).max(400),
      filename: z.string().trim().min(1).max(260),
      declaredMime: z.string().trim().min(3).max(120),
      sizeBytes: z.number().int().positive().max(15_000_000),
      sha256: z.string().trim().regex(/^[a-f0-9]{64}$/u).optional(),
    })
    .optional(),
});
export type SendMessageDto = z.infer<typeof sendMessageSchema>;

export const correctMessageSchema = z.object({
  clientMessageId: z.string().trim().min(8).max(64),
  body: z.string().trim().min(1).max(SUPPORT_MESSAGE_MAX_LENGTH),
  reason: z.string().trim().min(4).max(200),
});
export type CorrectMessageDto = z.infer<typeof correctMessageSchema>;

/**
 * Leer la conversación.
 *
 * `beforeSequence` es para subir por el historial; `afterSequence` es para el móvil, que pregunta
 * «¿hay algo nuevo desde el 12?» sin volver a bajarse los doce anteriores. Sin él, cada consulta de
 * novedades en una conexión mala descarga la conversación entera otra vez.
 */
export const transcriptQuerySchema = z.object({
  beforeSequence: z.string().regex(/^[0-9]+$/u).optional(),
  afterSequence: z.string().regex(/^[0-9]+$/u).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TranscriptQueryDto = z.infer<typeof transcriptQuerySchema>;

/**
 * Hasta dónde leyó quien avisa.
 *
 * Es una secuencia y no una marca de tiempo: el orden dentro del canal ya lo da `server_sequence`, y
 * un reloj de cliente mal puesto convertiría el «visto» en una discusión sobre husos horarios.
 */
/** El permiso de subida: sólo tipo y tamaño. La clave del objeto la propone el servidor. */
export const attachmentTicketSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  sizeBytes: z.number().int().positive().max(15_000_000),
});
export type AttachmentTicketDto = z.infer<typeof attachmentTicketSchema>;

export const markReadSchema = z.object({
  upToSequence: z.string().regex(/^[0-9]+$/u, 'Secuencia inválida.'),
});
export type MarkReadDto = z.infer<typeof markReadSchema>;

export const closeChannelSchema = z.object({
  reason: z.enum(SUPPORT_CHANNEL_CLOSE_REASONS).default('USER_ENDED'),
  note: z.string().trim().max(400).optional(),
});
export type CloseChannelDto = z.infer<typeof closeChannelSchema>;

export const presenceSchema = z.object({
  presenceState: z.enum(['AVAILABLE', 'BUSY', 'AWAY', 'OFFLINE', 'TRAINING', 'WRAP_UP']),
});
export type PresenceDto = z.infer<typeof presenceSchema>;
