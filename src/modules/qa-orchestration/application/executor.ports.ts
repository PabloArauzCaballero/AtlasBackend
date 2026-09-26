/**
 * @file Puertos del ejecutor QA: lo que necesita del mundo sin saber cómo se implementa.
 * @business Esta pieza permite probar el recorrido de una persona sin red ni base, y ejecutarlo en
 *   el worker con transporte HTTP real, cupos compartidos y persistencia durable.
 * @system interfaces del transporte, la admisión, el presupuesto y el registro de resultados.
 */
import type { QaStepStatus } from '../domain/qa-run.types.js';
import type { AssertionFailure } from '../domain/journey-assertions.js';

export type TransportRequest = {
  method: string;
  path: string;
  /** URL completa firmada por el backend (subidas al almacenamiento QA); reemplaza a la base de la API. */
  absoluteUrl?: string;
  /** Cuerpo binario tal cual (subidas); excluye `body`. */
  rawBody?: Uint8Array;
  query?: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal: AbortSignal;
};

/** `cookies` lleva las `Set-Cookie` de la respuesta (sesiones en cookie); nunca van a la evidencia. */
export type TransportResponse =
  | { status: number; body: unknown; latencyMs: number; cookies?: Record<string, string> }
  | { status: null; error: string; latencyMs: number };

export interface QaTransport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

/** Cupo por endpoint limitado. Compartido entre personas del mismo worker. */
export interface AdmissionPort {
  admit(bucket: string, perMinute: number, signal: AbortSignal): Promise<{ admissionLagMs: number }>;
}

/**
 * Presupuesto global de solicitudes y de solicitudes en vuelo. Se reserva ANTES de enviar: un
 * semáforo por proceso no alcanza con varios workers, así que la implementación real lo coordina
 * en la base.
 */
export interface BudgetPort {
  acquire(): Promise<{ ok: true; release: () => void } | { ok: false; reason: 'BUDGET_EXHAUSTED' | 'DEADLINE_EXCEEDED' | 'CANCELLED' }>;
}

/** Buzón QA: el último código enviado a una dirección desde `sinceIso`, o `null` si aún no llegó. */
export interface InboxPort {
  latestCode(input: { to: string; channel: string; sinceIso: string }): Promise<string | null>;
}

/** Credencial QA de vida corta para esta operación; no sustituye al token del actor de negocio. */
export interface QaCredentialPort {
  headerFor(input: { personaKey: string; logicalOperationId: string; attempt: number }): Record<string, string>;
}

export type AttemptRecord = {
  attempt: number;
  status: number | null;
  latencyMs: number;
  admissionLagMs: number;
  transportError?: string;
  requestId?: string;
  errorCode?: string | null;
};

export type StepRecord = {
  stepKey: string;
  workflowStepCode?: string;
  visitIndex: number;
  logicalOperationId: string;
  status: QaStepStatus;
  branch?: string;
  /** Motivo legible: causa raíz, rama no aplicable o aserción que falló. */
  reason?: string;
  /** Paso que causó la omisión en cascada. La causa raíz se enseña antes que la cascada. */
  rootCauseStepKey?: string;
  failures: AssertionFailure[];
  attempts: AttemptRecord[];
  /** Petición efectiva SANEADA y extracción visible (sin tokens). */
  evidence: { method: string; path: string; requestBody?: unknown; responseSummary?: unknown; extracted?: Record<string, unknown> };
  startedAt: string;
  finishedAt: string;
};

export interface StepSink {
  record(step: StepRecord): Promise<void>;
}
