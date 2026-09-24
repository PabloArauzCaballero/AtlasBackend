/**
 * @file Adaptador de infraestructura: réplica duradera del consentimiento del titular en el motor (P-09, B12).
 * @business Una revocación hecha con el motor caído no se pierde, y la base habilitante llega al motor
 *   ANTES de la primera decisión: sin ella el motor no decide.
 * @system escribe el estado deseado en la cola, intenta la entrega por el plano de gobierno y acusa,
 *   reprograma o da por superada (409 terminal) cada réplica.
 */
import { Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import type { ConsentReplicationStore } from './consent-replication.store.js';
import { engineErrorCode, type EngineTransportService } from './engine-transport.service.js';

export type ConsentBasis = 'CONSENT' | 'CONTRACT' | 'LEGAL_OBLIGATION' | 'CREDIT_PROTECTION' | 'LEGITIMATE_INTEREST';

/**
 * Respuestas 409 del motor que dicen «esta réplica ya está superada»: el motor conoce un alta o una
 * revocación más nueva. Reintentarlas daría el mismo 409 para siempre; se resuelven con ese motivo.
 */
export const TERMINAL_CONSENT_CODES: ReadonlySet<string> = new Set(['CONSENT_GRANT_REPLAYED', 'CONSENT_REVOCATION_STALE']);

/** Quién y para qué. `tenantId`/`customerId` hacen la réplica duradera; sin ellos es sólo un intento. */
export type ConsentReplicationInput = {
  subjectReference: string;
  purpose: string;
  tenantId?: string;
  customerId?: string;
  expiresAt?: Date | null;
  evidenceRef?: string | null;
  consentVersion?: string | null;
  /** Cuándo revocó el titular. Por omisión, ahora. */
  revokedAt?: Date | null;
};

export type ConsentDelivery = {
  action: 'grant' | 'revoke';
  subjectReference: string;
  purpose: string;
  basis?: string | null;
  grantedAt?: Date | null;
  expiresAt?: Date | null;
  evidenceRef?: string | null;
  consentVersion?: string | null;
  /** Fecha REAL de la revocación; el motor la usa para ordenar réplicas que llegan tarde. */
  revokedAt?: Date | null;
};

/**
 * Estado de la base habilitante antes de decidir.
 *
 * - `ready`: el motor la acusó; se puede decidir. `marker` identifica esa base para la clave de
 *   idempotencia (una decisión pedida SIN base queda guardada en el motor con su clave).
 * - `superseded`: el motor ya tenía un estado más nuevo (409 terminal). Se decide y el motor juzga.
 * - `pending`: no llegó; NO se decide y la solicitud queda para reintentar.
 * - `revoked`: Core pidió revocarla; no se decide.
 * - `unmaterialized`: un motor ANTERIOR a este contrato contestó 404 `SUBJECT_NOT_FOUND` (no sabía
 *   materializar al titular antes de su primera decisión, y tampoco exigía base). Se decide como antes y
 *   la réplica queda pendiente: el reintentador la entrega cuando el sujeto ya existe.
 */
export type BasisReadiness = {
  status: 'ready' | 'superseded' | 'pending' | 'revoked' | 'unmaterialized';
  marker: string | null;
  error?: string;
};

/** Respuesta de un motor anterior al contrato de base habilitante: no conoce al titular todavía. */
const LEGACY_UNKNOWN_SUBJECT = 'SUBJECT_NOT_FOUND';

type ReplicateInput = ConsentReplicationInput & { action: 'grant' | 'revoke'; basis: ConsentBasis | null; grantedAt: Date | null };

/**
 * La mitad del cliente del motor que habla de consentimientos.
 *
 * Vive aparte del cliente por tamaño y porque tiene estado propio (la cola); el cliente la expone
 * como `consents` y conserva `recordConsent`/`revokeConsent` para quien ya los llamaba.
 */
export class EngineConsentGateway {
  private readonly logger = new Logger(EngineConsentGateway.name);

  constructor(
    private readonly transport: EngineTransportService,
    private readonly isConfigured: () => boolean,
    private readonly store?: ConsentReplicationStore,
  ) {}

  /**
   * Entrega UNA réplica al motor y lanza si no llegó. Es lo que usa el reintentador; las llamadas
   * de negocio pasan por `recordConsent`/`revokeConsent`, que nunca lanzan.
   *
   * Va por el plano de GOBIERNO (o, si falta, el de desenlaces); nunca por la llave de ejecución:
   * quien decide no puede escribir el permiso que le autoriza a decidir.
   */
  async deliverConsent(input: ConsentDelivery): Promise<void> {
    const apiKey = env.DECISION_ENGINE_GOVERNANCE_API_KEY ?? env.DECISION_ENGINE_OUTCOME_API_KEY ?? '';
    if (input.action === 'revoke') {
      const url = `${this.transport.baseUrl()}/v1/risk-governance/consents/revoke`;
      await this.transport.call(url, apiKey, {
        subjectReference: input.subjectReference,
        purpose: input.purpose,
        // Siempre con la fecha real: sin ella el motor fecharía «ahora» una revocación que el titular
        // hizo mientras estaba caído, y una alta intermedia la dejaría por obsoleta.
        revokedAt: (input.revokedAt ?? new Date()).toISOString(),
      });
      return;
    }
    const url = `${this.transport.baseUrl()}/v1/risk-governance/consents`;
    await this.transport.call(url, apiKey, {
      subjectReference: input.subjectReference,
      purpose: input.purpose,
      basis: input.basis,
      grantedAt: (input.grantedAt ?? new Date()).toISOString(),
      ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
      ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
      ...(input.consentVersion ? { consentVersion: input.consentVersion } : {}),
    });
  }

  /**
   * Escribe el estado deseado (si hay a quién atribuirlo) y lo intenta entregar. Nunca lanza.
   *
   * Si la cola rechaza la petición por estar superada —un permiso más viejo que una revocación ya
   * pedida—, NO se entrega: mandarlo resucitaría en el motor lo que el titular retiró.
   */
  async replicate(input: ReplicateInput): Promise<boolean> {
    const pending = await this.persist(input);
    if (pending === 'superseded') {
      this.logger.warn(`Réplica de consentimiento (${input.action}) superada por una revocación posterior: no se entrega.`);
      return false;
    }
    if (!this.isConfigured()) return false;
    const outcome = await this.attempt({ ...input, revokedAt: input.revokedAt ?? pending?.requestedAt ?? null }, pending);
    return outcome.status === 'ready';
  }

  /**
   * La base habilitante de una finalidad, registrada en el motor ANTES de decidir (P-09).
   *
   * El motor, sin base, responde 422 `ENABLING_BASIS_MISSING` y guarda esa respuesta en la clave de
   * idempotencia. Por eso la base se escribe primero en la cola duradera y se entrega aquí, en línea;
   * si no llega, quien decide NO pregunta y la solicitud queda para reintentar. La fecha de alta es
   * la de la PRIMERA vez que Core afirmó esa base: reenviarla con otra fecha sería un «alta» distinta
   * y el motor la rechazaría como réplica vieja.
   */
  async ensureGranted(input: {
    tenantId: string;
    customerId: string;
    subjectReference: string;
    purpose: string;
    basis: ConsentBasis;
    consentVersion?: string | null;
    now: Date;
  }): Promise<BasisReadiness> {
    const key = { tenantId: input.tenantId, subjectReference: input.subjectReference, purposeCode: input.purpose };
    const current = this.store ? await this.store.findCurrent(key) : null;
    const settled = settledReadiness(current, input);
    if (settled) return settled;

    const grantedAt = current?.grantedAt ?? input.now;
    const request: ReplicateInput = { ...input, action: 'grant', grantedAt, expiresAt: null, consentVersion: input.consentVersion ?? null };
    const pending = await this.persist(request);
    if (pending === 'superseded') return { status: 'revoked', marker: null };
    if (!this.isConfigured()) return { status: 'pending', marker: null, error: 'DECISION_ENGINE_NOT_CONFIGURED' };
    const outcome = await this.attempt(request, pending);
    if (outcome.status === 'pending' && outcome.error === LEGACY_UNKNOWN_SUBJECT) {
      return { status: 'unmaterialized', marker: `u${markerOf(grantedAt)}`, error: outcome.error };
    }
    return { ...outcome, marker: outcome.status === 'pending' ? null : markerOf(grantedAt) };
  }

  /** Un intento de entrega con su acuse: sincronizada, superada (409 terminal) o pendiente. */
  private async attempt(
    input: ConsentDelivery,
    pending: { id: string; requestedAt: Date } | null,
  ): Promise<{ status: 'ready' | 'superseded' | 'pending'; error?: string }> {
    try {
      await this.deliverConsent(input);
      if (pending) await this.store?.markSynced(pending.id, pending.requestedAt, new Date());
      return { status: 'ready' };
    } catch (error) {
      const code = engineErrorCode(error);
      if (code && TERMINAL_CONSENT_CODES.has(code)) {
        this.logger.warn(`El motor ya conoce un estado más nuevo de la finalidad ${input.purpose} (${code}): la réplica queda resuelta.`);
        if (pending) await this.store?.markSuperseded(pending, code, new Date());
        return { status: 'superseded', error: code };
      }
      const message = (error as Error).message;
      this.logger.warn(`No se pudo replicar el consentimiento (${input.action}) en el motor; queda pendiente de reintento: ${message}`);
      if (pending) await this.store?.markFailed({ id: pending.id, attempts: 0, requestedAt: pending.requestedAt }, message, new Date());
      return { status: 'pending', error: code === LEGACY_UNKNOWN_SUBJECT ? code : message };
    }
  }

  private async persist(input: ReplicateInput): Promise<{ id: string; requestedAt: Date } | 'superseded' | null> {
    if (!this.store || !input.tenantId || !input.customerId) return null;
    const row = await this.store.request({
      tenantId: input.tenantId,
      customerId: input.customerId,
      subjectReference: input.subjectReference,
      purposeCode: input.purpose,
      action: input.action,
      basis: input.basis,
      grantedAt: input.grantedAt,
      expiresAt: input.expiresAt ?? null,
      consentVersion: input.consentVersion ?? null,
      // Una revocación se ordena por CUÁNDO revocó el titular, no por cuándo se encoló.
      now: input.action === 'revoke' && input.revokedAt ? input.revokedAt : new Date(),
    });
    return row ?? 'superseded';
  }
}

/**
 * Lo que ya está resuelto sin llamar al motor: revocada por Core, o la MISMA base ya acusada o ya
 * superada. `null` = hay que (re)entregarla.
 */
function settledReadiness(
  current: { action: string; status: string; basis: string | null; consentVersion?: string | null; grantedAt: Date | null } | null,
  input: { basis: ConsentBasis; consentVersion?: string | null },
): BasisReadiness | null {
  if (!current) return null;
  if (current.action === 'revoke') return { status: 'revoked', marker: null };
  const unchanged = current.basis === input.basis && (current.consentVersion ?? null) === (input.consentVersion ?? null);
  if (!unchanged) return null;
  if (current.status === 'synced') return { status: 'ready', marker: markerOf(current.grantedAt) };
  if (current.status === 'superseded') return { status: 'superseded', marker: `s${markerOf(current.grantedAt)}` };
  return null;
}

function markerOf(grantedAt: Date | null | undefined): string {
  return String(grantedAt ? new Date(grantedAt).getTime() : 0);
}
