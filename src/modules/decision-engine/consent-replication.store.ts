/**
 * @file Puerto de persistencia: la cola duradera de réplica de consentimientos hacia el motor (P-09, B12).
 * @business Una revocación hecha con el motor caído no se pierde: queda pendiente hasta que el motor la acusa.
 * @system una fila por (tenant, sujeto, finalidad) con el ÚLTIMO estado deseado; reintento con espera creciente.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { DecisionConsentReplicationModel } from '../../database/models/index.js';
import { CREDIT_DECISION_PURPOSE } from './subject-reference.service.js';

export type ConsentReplicationRequest = {
  tenantId: string;
  customerId: string;
  subjectReference: string;
  purposeCode: string;
  action: 'grant' | 'revoke';
  basis?: string | null;
  grantedAt?: Date | null;
  expiresAt?: Date | null;
  sourceConsentId?: string | null;
  consentVersion?: string | null;
  now: Date;
};

/** Espera antes del siguiente intento: 1, 4, 9… minutos, con techo de una hora (como el outbox). */
export function replicationBackoff(now: Date, attempts: number): Date {
  const minutes = Math.min(60, Math.max(1, attempts * attempts));
  return new Date(now.getTime() + minutes * 60_000);
}

@Injectable()
export class ConsentReplicationStore {
  constructor(
    @InjectModel(DecisionConsentReplicationModel) private readonly model: typeof DecisionConsentReplicationModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  private get table(): string {
    return `${atlasSchemaFor('decision_consent_replications')}.decision_consent_replications`;
  }

  /**
   * Deja escrito lo que el motor debe llegar a saber. Devuelve la fila y su `requested_at`.
   *
   * Upsert por sujeto y finalidad: el motor sólo necesita el ÚLTIMO estado. Un permiso NO pisa una
   * revocación posterior a él (una réplica de permiso vieja no puede resucitar lo que el titular
   * retiró); una revocación pisa siempre.
   */
  async request(input: ConsentReplicationRequest, transaction?: Transaction): Promise<{ id: string; requestedAt: Date } | null> {
    const rows = await this.sequelize.query<{ id: string; requested_at: Date }>(
      `INSERT INTO ${this.table}
         (_tenant_id, customer_id, subject_reference, purpose_code, action, basis, granted_at, expires_at, source_consent_id,
          consent_version, status, attempts, next_attempt_at, last_error, requested_at, synced_at, _created_at, _updated_at)
       VALUES ($tenantId, $customerId, $subjectReference, $purposeCode, $action, $basis, $grantedAt, $expiresAt, $sourceConsentId,
          $consentVersion, 'pending', 0, $now, NULL, $now, NULL, $now, $now)
       ON CONFLICT (_tenant_id, subject_reference, purpose_code) DO UPDATE SET
          customer_id = EXCLUDED.customer_id, action = EXCLUDED.action, basis = EXCLUDED.basis,
          granted_at = EXCLUDED.granted_at, expires_at = EXCLUDED.expires_at, source_consent_id = EXCLUDED.source_consent_id,
          consent_version = EXCLUDED.consent_version, status = 'pending', attempts = 0, next_attempt_at = EXCLUDED.next_attempt_at,
          last_error = NULL, resolution_code = NULL, requested_at = EXCLUDED.requested_at, synced_at = NULL,
          _updated_at = EXCLUDED._updated_at
        WHERE NOT (${this.table}.action = 'revoke' AND EXCLUDED.action = 'grant'
                   AND ${this.table}.requested_at > COALESCE(EXCLUDED.granted_at, EXCLUDED.requested_at))
       RETURNING _id::text AS id, requested_at`,
      {
        type: QueryTypes.SELECT,
        bind: {
          tenantId: input.tenantId,
          customerId: input.customerId,
          subjectReference: input.subjectReference,
          purposeCode: input.purposeCode,
          action: input.action,
          basis: input.basis ?? null,
          grantedAt: input.grantedAt ?? null,
          expiresAt: input.expiresAt ?? null,
          sourceConsentId: input.sourceConsentId ?? null,
          consentVersion: input.consentVersion ?? null,
          now: input.now,
        },
        transaction,
      },
    );
    const row = rows[0];
    return row ? { id: row.id, requestedAt: new Date(row.requested_at) } : null;
  }

  /**
   * Acusa la entrega. Sólo si nadie pidió algo más nuevo mientras tanto (`requested_at` igual): una
   * entrega vieja no puede dar por sincronizada una revocación que llegó después.
   */
  async markSynced(id: string, requestedAt: Date, now: Date): Promise<boolean> {
    const [updated] = await this.model.update(
      { status: 'synced', syncedAt: now, lastError: null, updatedAtValue: now },
      { where: { id, requestedAt, status: 'pending' } },
    );
    return updated === 1;
  }

  /**
   * El motor respondió que esta réplica ya está superada (409 `CONSENT_GRANT_REPLAYED` /
   * `CONSENT_REVOCATION_STALE`): conoce un estado más nuevo. Es terminal: no se reintenta, y el motivo
   * queda escrito. Igual que el acuse, sólo si nadie pidió algo más nuevo mientras tanto.
   */
  async markSuperseded(row: { id: string; requestedAt: Date }, code: string, now: Date): Promise<boolean> {
    const [updated] = await this.model.update(
      { status: 'superseded', resolutionCode: code.slice(0, 60), lastError: null, syncedAt: now, updatedAtValue: now },
      { where: { id: row.id, requestedAt: row.requestedAt, status: 'pending' } },
    );
    return updated === 1;
  }

  /** La réplica vigente de un sujeto y finalidad, si existe. */
  findCurrent(input: { tenantId: string; subjectReference: string; purposeCode: string }): Promise<DecisionConsentReplicationModel | null> {
    return this.model.findOne({
      where: { tenantId: input.tenantId, subjectReference: input.subjectReference, purposeCode: input.purposeCode },
    });
  }

  async markFailed(row: { id: string; attempts: number; requestedAt: Date }, error: string, now: Date): Promise<void> {
    const attempts = row.attempts + 1;
    await this.model.update(
      { attempts, nextAttemptAt: replicationBackoff(now, attempts), lastError: error.slice(0, 2_000), updatedAtValue: now },
      { where: { id: row.id, requestedAt: row.requestedAt, status: 'pending' } },
    );
  }

  /** Lo que toca intentar ahora, de lo más antiguo a lo más nuevo. */
  listDue(input: { tenantId: string | null; limit: number; now: Date }): Promise<DecisionConsentReplicationModel[]> {
    return this.model.findAll({
      where: {
        status: 'pending',
        nextAttemptAt: { [Op.lte]: input.now },
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
      order: [['requestedAt', 'ASC']],
      limit: input.limit,
    });
  }

  /**
   * Repara lo que nadie encoló: revocaciones registradas en el core que el motor no ha recibido.
   *
   * La revocación vive en `customer_consents` (la escribe el módulo de datos externos, que no puede
   * depender de éste). En vez de acoplarlos, cada pasada busca revocaciones sin réplica igual o más
   * nueva y las encola. Sólo para clientes que el motor conoce: los que tienen sujeto de crédito.
   */
  async enqueueMissingRevocations(input: { tenantId: string | null; limit: number; now: Date }): Promise<number> {
    const consents = `${atlasSchemaFor('customer_consents')}.customer_consents`;
    const links = `${atlasSchemaFor('decision_subject_links')}.decision_subject_links`;
    const rows = await this.sequelize.query<{ id: string }>(
      `INSERT INTO ${this.table}
         (_tenant_id, customer_id, subject_reference, purpose_code, action, source_consent_id,
          status, attempts, next_attempt_at, requested_at, _created_at, _updated_at)
       SELECT c._tenant_id, c.customer_id, l.subject_reference, c.purpose_code, 'revoke', c._id,
              'pending', 0, $now, c.revoked_at, $now, $now
         FROM ${consents} c
         JOIN ${links} l ON l._tenant_id = c._tenant_id AND l.customer_id = c.customer_id AND l.purpose_code = $creditPurpose
        WHERE c.revoked_at IS NOT NULL AND c.purpose_code IS NOT NULL AND c.customer_id IS NOT NULL
          AND ($tenantId::bigint IS NULL OR c._tenant_id = $tenantId::bigint)
          AND NOT EXISTS (
            SELECT 1 FROM ${this.table} r
             WHERE r._tenant_id = c._tenant_id AND r.subject_reference = l.subject_reference AND r.purpose_code = c.purpose_code
               AND r.action = 'revoke' AND r.requested_at >= c.revoked_at)
        ORDER BY c.revoked_at ASC
        LIMIT $limit
       ON CONFLICT (_tenant_id, subject_reference, purpose_code) DO UPDATE SET
          action = 'revoke', source_consent_id = EXCLUDED.source_consent_id, status = 'pending', attempts = 0,
          next_attempt_at = EXCLUDED.next_attempt_at, last_error = NULL, resolution_code = NULL, requested_at = EXCLUDED.requested_at,
          synced_at = NULL, _updated_at = EXCLUDED._updated_at
       RETURNING _id::text AS id`,
      {
        type: QueryTypes.SELECT,
        bind: { tenantId: input.tenantId, limit: input.limit, now: input.now, creditPurpose: CREDIT_DECISION_PURPOSE },
      },
    );
    return rows.length;
  }

  /** Cuántas siguen sin acusar y desde cuándo: lo que un operador mira para saber si la réplica va al día. */
  async summarize(tenantId: string | null): Promise<{ pending: number; pendingRevocations: number; oldestPendingAt: Date | null }> {
    const scope = tenantId ? { tenantId } : {};
    const [pending, pendingRevocations, oldest] = await Promise.all([
      this.model.count({ where: { ...scope, status: 'pending' } }),
      this.model.count({ where: { ...scope, status: 'pending', action: 'revoke' } }),
      this.model.min<Date | null, DecisionConsentReplicationModel>('requestedAt', { where: { ...scope, status: 'pending' } }),
    ]);
    return { pending, pendingRevocations, oldestPendingAt: oldest ?? null };
  }
}
