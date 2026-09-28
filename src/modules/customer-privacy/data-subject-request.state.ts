/**
 * @file Reglas puras: la máquina de estados y el plazo de una solicitud del titular.
 * @business Una solicitud de derechos tiene un plazo legal de 15 días naturales y un camino explícito hasta cerrarse.
 * @system sin dependencias: decide qué transición es válida, cuándo exige motivo y cuándo una solicitud está vencida.
 */

/** Los cuatro estados reales de `privacy.data_subject_requests.status`. */
export const DATA_SUBJECT_REQUEST_STATUSES = ['received', 'in_progress', 'completed', 'rejected'] as const;
export type DataSubjectRequestStatus = (typeof DATA_SUBJECT_REQUEST_STATUSES)[number];

/** Estados en los que la solicitud sigue esperando a alguien; sólo éstos pueden vencer. */
export const DATA_SUBJECT_REQUEST_OPEN_STATUSES: readonly DataSubjectRequestStatus[] = ['received', 'in_progress'];

/**
 * Tipos que existen en la tabla. La app crea los seis primeros; `erasure` y `objection` vienen de
 * datos anteriores y de la siembra, y hay que poder filtrarlos igual.
 */
export const DATA_SUBJECT_REQUEST_TYPES = [
  'access',
  'rectification',
  'deletion',
  'portability',
  'revocation',
  'restriction',
  'erasure',
  'objection',
] as const;

/** Plazo legal: 15 días NATURALES desde la recepción (no hábiles). */
export const DATA_SUBJECT_REQUEST_DUE_DAYS = 15;
const DIA_MS = 86_400_000;

/**
 * received → in_progress → completed | rejected. Nada vuelve atrás y nada sale de un estado final.
 *
 * `received → completed` no existe a propósito: cerrar sin haberla tomado deja una solicitud
 * atendida sin que conste quién la atendió ni desde cuándo. Tomarla es un clic y deja ese rastro.
 */
const TRANSICIONES: Readonly<Record<DataSubjectRequestStatus, readonly DataSubjectRequestStatus[]>> = {
  received: ['in_progress'],
  in_progress: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};

/** Cerrar (en cualquier sentido) exige motivo: es lo que se le contesta al titular y lo que se audita. */
const EXIGEN_MOTIVO: ReadonlySet<DataSubjectRequestStatus> = new Set(['completed', 'rejected']);

export type TransitionVerdict =
  { ok: true; terminal: boolean } | { ok: false; code: 'DATA_SUBJECT_REQUEST_INVALID_TRANSITION' | 'DATA_SUBJECT_REQUEST_REASON_REQUIRED' };

export function allowedTransitions(from: string | null): readonly DataSubjectRequestStatus[] {
  return TRANSICIONES[(from ?? 'received') as DataSubjectRequestStatus] ?? [];
}

export function evaluateTransition(from: string | null, to: DataSubjectRequestStatus, reason: string | undefined): TransitionVerdict {
  if (!allowedTransitions(from).includes(to)) return { ok: false, code: 'DATA_SUBJECT_REQUEST_INVALID_TRANSITION' };
  if (EXIGEN_MOTIVO.has(to) && !reason?.trim()) return { ok: false, code: 'DATA_SUBJECT_REQUEST_REASON_REQUIRED' };
  return { ok: true, terminal: EXIGEN_MOTIVO.has(to) };
}

/** Vencimiento calculado desde la recepción, no leído de `due_at`: así no depende de quién escribió la fila. */
export function dueDateFrom(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + DATA_SUBJECT_REQUEST_DUE_DAYS * DIA_MS);
}

/** Vencida = sigue abierta y el plazo ya pasó. Una solicitud cerrada tarde no está «vencida»: está cerrada. */
export function isOverdue(status: string | null, receivedAt: Date, now: Date): boolean {
  const abierta = DATA_SUBJECT_REQUEST_OPEN_STATUSES.includes((status ?? 'received') as DataSubjectRequestStatus);
  return abierta && dueDateFrom(receivedAt).getTime() < now.getTime();
}
