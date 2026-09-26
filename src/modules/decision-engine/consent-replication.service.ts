/**
 * @file Servicio de aplicación: el reintentador de la réplica de consentimientos al motor (P-09, B12).
 * @business Lo que el titular revocó llega al motor aunque éste estuviera caído al revocar.
 * @system encola revocaciones sin réplica, entrega lo pendiente vencido y acusa o reprograma fila a fila.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConsentReplicationStore } from './consent-replication.store.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { TERMINAL_CONSENT_CODES } from './engine-consent.gateway.js';
import { engineErrorCode } from './engine-transport.service.js';

export type ConsentSyncResult = {
  enqueued: number;
  synced: number;
  failed: number;
  /** Resueltas por un 409 terminal del motor (`CONSENT_GRANT_REPLAYED`, `CONSENT_REVOCATION_STALE`). */
  superseded?: number;
  pending: number;
  pendingRevocations: number;
  oldestPendingAt: Date | null;
  reason?: 'DECISION_ENGINE_NOT_CONFIGURED';
};

@Injectable()
export class ConsentReplicationService {
  private readonly logger = new Logger(ConsentReplicationService.name);

  constructor(
    private readonly client: DecisionEngineClient,
    private readonly store: ConsentReplicationStore,
  ) {}

  /**
   * Una pasada del trabajo `sync_engine_consents`.
   *
   * Fila a fila y no en lote: una réplica que el motor rechaza (sujeto aún desconocido, por ejemplo)
   * no puede dejar sin entregar la revocación de al lado. Sin motor configurado no se entrega nada y
   * las filas siguen `pending` —y con ellas el bloqueo local del desembolso—: la cola lo dice en vez
   * de dar la réplica por hecha.
   */
  async sync(input: { tenantId: string | null; limit: number; now?: Date }): Promise<ConsentSyncResult> {
    const now = input.now ?? new Date();
    const enqueued = await this.store.enqueueMissingRevocations({ tenantId: input.tenantId, limit: input.limit, now });
    if (!this.client.isConfigured) {
      return { enqueued, synced: 0, failed: 0, ...(await this.store.summarize(input.tenantId)), reason: 'DECISION_ENGINE_NOT_CONFIGURED' };
    }

    let synced = 0;
    let failed = 0;
    let superseded = 0;
    for (const row of await this.store.listDue({ tenantId: input.tenantId, limit: input.limit, now })) {
      try {
        await this.client.consents.deliverConsent({
          action: row.action,
          subjectReference: row.subjectReference,
          purpose: row.purposeCode,
          basis: row.basis,
          grantedAt: row.grantedAt,
          expiresAt: row.expiresAt,
          consentVersion: row.consentVersion,
          // En una revocación `requested_at` ES la fecha en que el titular revocó (la cola la ordena así).
          revokedAt: row.action === 'revoke' ? row.requestedAt : null,
        });
        if (await this.store.markSynced(row.id, row.requestedAt, new Date())) synced += 1;
      } catch (error) {
        const code = engineErrorCode(error);
        if (code && TERMINAL_CONSENT_CODES.has(code)) {
          // 409 terminal: el motor ya conoce un estado más nuevo. Reintentarlo sería el mismo 409 siempre.
          if (await this.store.markSuperseded(row, code, new Date())) superseded += 1;
          continue;
        }
        failed += 1;
        await this.store.markFailed(row, (error as Error).message ?? 'CONSENT_REPLICATION_FAILED', new Date());
      }
    }
    if (failed > 0) this.logger.warn(`${failed} réplicas de consentimiento siguen pendientes; el motivo de cada una queda en last_error.`);
    return { enqueued, synced, failed, superseded, ...(await this.store.summarize(input.tenantId)) };
  }
}
