/**
 * @file Servicio de aplicación: entrega al ERP, firmados y en orden, los avisos de pago de Core (P-14).
 * @business Un pago confirmado por el comercio en Core llega al ERP aunque la red falle, el ERP esté
 *   caído o el worker muera a mitad: al menos una vez, en orden por cuota, y visible si se agota.
 * @system Tres pasos cortos, sin transacción larga durante la red: (1) reserva con lease y
 *   `FOR UPDATE SKIP LOCKED` sólo de la CABEZA de cada cuota (la versión N+1 espera a la N); (2) POST
 *   firmado fuera de transacción; (3) marca condicional al lease: `delivered` con 2xx, backoff
 *   exponencial con tope, o `dead` al agotar intentos o ante un rechazo de contrato.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../config/env.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { SignedEventPublisher, type DeliveryResult } from './signed-event-publisher.js';

const DELIVERIES = `${atlasSchemaFor('outbound_event_deliveries')}.outbound_event_deliveries`;
export const ERP_DESTINATION = 'atlas-erp';

export type DeliveryPolicy = Readonly<{ leaseMs: number; maxAttempts: number; retryBaseMs: number; retryMaxMs: number }>;

export type DeliveryRunResult = {
  configured: boolean;
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
};

type ClaimedRow = { id: string; attempts: number; envelope: { eventKey: string; topic: string } };

/** Espera antes del intento `attempts + 1`: base · 2^(n−1) con tope. Determinista (sin azar). */
export function nextDelayMs(attempts: number, policy: DeliveryPolicy): number {
  return Math.min(policy.retryMaxMs, policy.retryBaseMs * 2 ** Math.max(0, attempts - 1));
}

@Injectable()
export class ErpEventDeliveryService {
  private readonly logger = new Logger(ErpEventDeliveryService.name);
  private readonly publisher: SignedEventPublisher | null;
  private readonly policy: DeliveryPolicy;

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @Optional() publisher?: SignedEventPublisher,
    @Optional() policy?: DeliveryPolicy,
  ) {
    this.publisher =
      publisher ??
      (env.ERP_EVENTS_DELIVERY_URL && env.ERP_EVENTS_DELIVERY_SECRET
        ? new SignedEventPublisher({
            url: env.ERP_EVENTS_DELIVERY_URL,
            secret: env.ERP_EVENTS_DELIVERY_SECRET,
            timeoutMs: env.ERP_EVENTS_DELIVERY_TIMEOUT_MS,
          })
        : null);
    this.policy = policy ?? {
      leaseMs: env.ERP_EVENTS_DELIVERY_LEASE_MS,
      maxAttempts: env.ERP_EVENTS_DELIVERY_MAX_ATTEMPTS,
      retryBaseMs: env.ERP_EVENTS_DELIVERY_RETRY_BASE_MS,
      retryMaxMs: env.ERP_EVENTS_DELIVERY_RETRY_MAX_MS,
    };
  }

  /** Una pasada: reserva hasta `limit` cabezas de cuota del tenant y las entrega. */
  async deliverPending(input: { tenantId: string; limit: number }): Promise<DeliveryRunResult> {
    const result: DeliveryRunResult = { configured: this.publisher !== null, claimed: 0, delivered: 0, retried: 0, dead: 0 };
    // Sin receptor configurado no se reserva nada: las entregas siguen `pending` y visibles.
    if (!this.publisher) return result;
    const owner = `erp-delivery-${process.pid}-${randomUUID().slice(0, 8)}`;
    const rows = await this.claim(input.tenantId, input.limit, owner);
    result.claimed = rows.length;
    for (const row of rows) {
      const delivery = await this.publisher.publish(row.envelope, row.attempts);
      const counter = await this.settle(row, owner, delivery);
      if (counter) result[counter] += 1;
    }
    return result;
  }

  private claim(tenantId: string, limit: number, owner: string): Promise<ClaimedRow[]> {
    return this.sequelize.transaction((transaction) =>
      this.sequelize.query<ClaimedRow>(
        `WITH candidates AS (
           SELECT d._id FROM ${DELIVERIES} d
            WHERE d.destination = $destination AND d._tenant_id = $tenantId AND d.status = 'pending'
              AND d.next_attempt_at <= now()
              AND (d.lease_expires_at IS NULL OR d.lease_expires_at < now())
              AND NOT EXISTS (
                SELECT 1 FROM ${DELIVERIES} prev
                 WHERE prev.destination = d.destination AND prev.aggregate_type = d.aggregate_type
                   AND prev.aggregate_id = d.aggregate_id AND prev.status IN ('pending', 'dead')
                   AND (prev.aggregate_version, prev._id) < (d.aggregate_version, d._id))
            ORDER BY d.next_attempt_at, d._id
            LIMIT $limit
            FOR UPDATE SKIP LOCKED)
         UPDATE ${DELIVERIES} AS d
            SET lease_owner = $owner, lease_expires_at = now() + ($leaseMs::text || ' milliseconds')::interval,
                attempts = d.attempts + 1, _updated_at = now()
           FROM candidates WHERE d._id = candidates._id
         RETURNING d._id::text AS id, d.attempts, d.envelope`,
        {
          type: QueryTypes.SELECT,
          transaction,
          bind: { destination: ERP_DESTINATION, tenantId, limit, owner, leaseMs: String(this.policy.leaseMs) },
        },
      ),
    );
  }

  private async settle(row: ClaimedRow, owner: string, delivery: DeliveryResult): Promise<'delivered' | 'retried' | 'dead' | null> {
    const exhausted = row.attempts >= this.policy.maxAttempts;
    const next: { status: 'delivered' | 'pending' | 'dead'; counter: 'delivered' | 'retried' | 'dead' } =
      delivery.outcome === 'ACK'
        ? { status: 'delivered', counter: 'delivered' }
        : delivery.outcome === 'REJECTED' || exhausted
          ? { status: 'dead', counter: 'dead' }
          : { status: 'pending', counter: 'retried' };
    const rows = await this.sequelize.query<{ id: string }>(
      `UPDATE ${DELIVERIES}
          SET status = $status::varchar,
              delivered_at = CASE WHEN $status::varchar = 'delivered' THEN now() ELSE NULL END,
              next_attempt_at = CASE WHEN $status::varchar = 'pending'
                                     THEN now() + ($delayMs::text || ' milliseconds')::interval ELSE next_attempt_at END,
              last_error = $error::varchar, last_http_status = $httpStatus::integer,
              lease_owner = NULL, lease_expires_at = NULL, _updated_at = now()
        WHERE _id = $id::bigint AND lease_owner = $owner AND status = 'pending'
        RETURNING _id::text AS id`,
      {
        type: QueryTypes.SELECT,
        bind: {
          id: row.id,
          owner,
          status: next.status,
          delayMs: String(nextDelayMs(row.attempts, this.policy)),
          error: delivery.outcome === 'ACK' ? null : delivery.error,
          httpStatus: delivery.httpStatus,
        },
      },
    );
    if (rows.length === 0) {
      // Otro proceso retomó la entrega tras vencer este lease: su resultado es el que vale.
      this.logger.warn(`ERP_DELIVERY_LEASE_LOST ${row.envelope.eventKey}`);
      return null;
    }
    if (next.status === 'dead') {
      this.logger.error(`Entrega al ERP en DEAD tras ${row.attempts} intento(s): ${row.envelope.topic} ${row.envelope.eventKey}`);
    }
    return next.counter;
  }
}
